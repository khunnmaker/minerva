import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';

export type CeresTx = Prisma.TransactionClient;

export type CashDirection = 'in' | 'out';
export interface BalanceMovement {
  amount: string;
  direction: string | null;
  type: string;
}

export function legacyCashDirection(type: string): CashDirection | null {
  if (type === 'advance') return 'out';
  if (type === 'deposit' || type === 'topup' || type === 'refund') return 'in';
  return null;
}

function amountToSatang(value: string): number {
  const normalized = (value || '').replace(/[^\d.-]/g, '');
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function cashBalanceFromMovements(rows: readonly BalanceMovement[]): number {
  return rows.reduce((total, row) => {
    const direction = row.direction === 'in' || row.direction === 'out' ? row.direction : legacyCashDirection(row.type);
    if (!direction) return total;
    const amount = Number.parseFloat((row.amount || '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(amount)) return total;
    return total + (direction === 'in' ? amount : -amount);
  }, 0);
}

export class CashLedgerError extends Error {
  constructor(
    public readonly code: 'cash_account_missing' | 'insufficient_cash',
    public readonly balance = 0,
  ) {
    super(code);
  }
}

// Every close and cash-out takes this singleton lock first. PostgreSQL holds it to
// transaction end, serializing balance reads and inserts without changing v1 math.
export async function lockPettyCash(tx: CeresTx): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "CashAccount" WHERE "id" = 'pettyCash' FOR UPDATE
  `;
  if (rows.length !== 1) throw new CashLedgerError('cash_account_missing');
}

export async function pettyCashBalance(tx: CeresTx, cutoff?: Date): Promise<number> {
  const rows = await tx.cashMovement.findMany({
    where: { accountId: 'pettyCash', ...(cutoff ? { createdAt: { lte: cutoff } } : {}) },
    select: { amount: true, direction: true, type: true },
  });
  return cashBalanceFromMovements(rows);
}

export interface OutgoingCashMovementInput {
  type: 'advance' | 'request_payment';
  amount: string;
  partyId?: string | null;
  partyName?: string;
  entity?: string;
  note?: string;
  createdById?: string | null;
  createdByName?: string;
  requestId?: string | null;
  requestMoneyEventId?: string | null;
}

export async function createOutgoingCashMovement(input: OutgoingCashMovementInput) {
  return prisma.$transaction(async (tx) => {
    await lockPettyCash(tx);
    const balance = await pettyCashBalance(tx);
    if (amountToSatang(input.amount) > amountToSatang(balance.toFixed(2))) {
      throw new CashLedgerError('insufficient_cash', balance);
    }
    return tx.cashMovement.create({
      data: {
        accountId: 'pettyCash',
        type: input.type,
        direction: 'out',
        partyId: input.partyId ?? null,
        partyName: input.partyName ?? '',
        entity: input.entity ?? '',
        amount: input.amount,
        note: input.note ?? '',
        createdById: input.createdById ?? null,
        createdByName: input.createdByName ?? '',
        requestId: input.requestId ?? null,
        requestMoneyEventId: input.requestMoneyEventId ?? null,
      },
    });
  });
}

export type LegacyAdvanceInput = Omit<OutgoingCashMovementInput, 'type' | 'requestId' | 'requestMoneyEventId'>;

export function createLegacyAdvance(input: LegacyAdvanceInput) {
  return createOutgoingCashMovement({ ...input, type: 'advance' });
}

export const requestMoneyKindSchema = z.enum(['payment', 'purchase', 'refund', 'reversal']);
export const requestMoneyLaneSchema = z.enum(['cash', 'transfer']);

export interface RecordRequestMoneyInput {
  requestId: string;
  kind: z.infer<typeof requestMoneyKindSchema>;
  lane: z.infer<typeof requestMoneyLaneSchema>;
  amount: string;
  transferSlipUploadId?: string;
  purchaseReceiptUploadId?: string;
  reversesEventId?: string;
  createdById?: string | null;
  createdByName?: string;
  note?: string;
  idempotencyKey?: string;
}

export class RequestMoneyError extends Error {
  constructor(public readonly code: 'not_found' | 'not_approved' | 'already_fulfilled' | 'invalid_evidence') {
    super(code);
  }
}

// Phase-1 service foundation. No route calls this yet; Phase 3 will add projection
// updates and UI endpoints. The append-only event + movement are nevertheless fully
// atomic and cash events share the same singleton lock as legacy advances/closes.
export async function recordRequestMoneyEvent(input: RecordRequestMoneyInput) {
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || amountToSatang(input.amount) <= 0) {
    throw new RequestMoneyError('invalid_evidence');
  }
  return prisma.$transaction(async (tx) => {
    if (input.lane === 'cash') await lockPettyCash(tx);
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CeresPaymentRequest" WHERE "id" = ${input.requestId} FOR UPDATE
    `;

    if (input.idempotencyKey) {
      const replay = await tx.ceresRequestMoneyEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (replay) return replay;
    }
    const request = await tx.ceresPaymentRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw new RequestMoneyError('not_found');
    if (request.workflowVersion !== 2 || request.approvalStatus !== 'approved') {
      throw new RequestMoneyError('not_approved');
    }

    if (input.kind !== 'refund' && input.kind !== 'reversal') {
      const initialEvents = await tx.ceresRequestMoneyEvent.findMany({
        where: { requestId: request.id, kind: { in: ['payment', 'purchase'] } },
        select: { id: true },
      });
      if (initialEvents.length > 0) {
        const reversals = await tx.ceresRequestMoneyEvent.findMany({
          where: { requestId: request.id, kind: 'reversal', reversesEventId: { in: initialEvents.map((event) => event.id) } },
          select: { reversesEventId: true },
        });
        const reversedIds = new Set(reversals.map((event) => event.reversesEventId));
        if (initialEvents.some((event) => !reversedIds.has(event.id))) {
          throw new RequestMoneyError('already_fulfilled');
        }
      }
    }
    if ((input.lane === 'transfer' && !input.transferSlipUploadId) ||
        (input.kind === 'purchase' && !input.purchaseReceiptUploadId)) {
      throw new RequestMoneyError('invalid_evidence');
    }

    const reversed = input.kind === 'reversal' && input.reversesEventId
      ? await tx.ceresRequestMoneyEvent.findUnique({ where: { id: input.reversesEventId } })
      : null;
    if (input.kind === 'reversal') {
      if (!reversed || reversed.requestId !== request.id || reversed.lane !== input.lane || reversed.kind === 'reversal' ||
          amountToSatang(reversed.amount) !== amountToSatang(input.amount)) {
        throw new RequestMoneyError('invalid_evidence');
      }
      const priorReversal = await tx.ceresRequestMoneyEvent.findFirst({
        where: { requestId: request.id, kind: 'reversal', reversesEventId: reversed.id },
        select: { id: true },
      });
      if (priorReversal) throw new RequestMoneyError('invalid_evidence');
    }

    let direction: CashDirection | null = null;
    let reversesMovementId: string | null = null;
    if (input.lane === 'cash') {
      direction = input.kind === 'refund' ? 'in' : 'out';
      if (reversed) {
        direction = reversed.kind === 'refund' ? 'out' : 'in';
        reversesMovementId = reversed.cashMovementId;
      }
      if (direction === 'out') {
        const balance = await pettyCashBalance(tx);
        if (amountToSatang(input.amount) > amountToSatang(balance.toFixed(2))) {
          throw new CashLedgerError('insufficient_cash', balance);
        }
      }
    }

    const eventId = randomUUID();
    const movementId = direction ? randomUUID() : null;
    const event = await tx.ceresRequestMoneyEvent.create({
      data: {
        id: eventId,
        requestId: request.id,
        kind: input.kind,
        lane: input.lane,
        amount: input.amount,
        transferSlipUploadId: input.transferSlipUploadId ?? null,
        purchaseReceiptUploadId: input.purchaseReceiptUploadId ?? null,
        cashMovementId: movementId,
        reversesEventId: input.reversesEventId ?? null,
        createdById: input.createdById ?? null,
        createdByName: input.createdByName ?? '',
        note: input.note ?? '',
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    if (direction && movementId) {
      await tx.cashMovement.create({
        data: {
          id: movementId,
          accountId: 'pettyCash',
          type: input.kind === 'refund' ? 'request_refund' : input.kind === 'reversal' ? 'reversal' : 'request_payment',
          direction,
          amount: input.amount,
          requestId: request.id,
          requestMoneyEventId: event.id,
          reversesMovementId,
          note: input.note ?? '',
          createdById: input.createdById ?? null,
          createdByName: input.createdByName ?? '',
        },
      });
    }
    return event;
  });
}
