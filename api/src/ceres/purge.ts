import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import type { AuthedAgent } from '../auth/jwt.js';
import { syncAdvanceLiquidationProjection } from './requestMoney.js';

// ─── Ceres alpha hard-purge (owner directive, 2026-07-22) ─────────────────────────────
// "as this is still alpha test I want ability to cleanse each entry like it hasn't
// happened before" — a CEO-ONLY, env-gated HARD delete of a single request/expense/cash
// movement and its ENTIRE dependent graph, run in one transaction. Unlike voidStaffRequest
// / the expense void endpoint (soft-delete: the row stays, struck-through, forever
// auditable), purge REMOVES the rows — no audit trail is written on purpose, matching the
// "like it never happened" spec. This is alpha-only tooling: CERES_ALPHA_PURGE must be
// flipped to '0' before a real production launch (see docs/CERES_ALPHA_PURGE.md).
//
// Closed CeresSettlement / CeresSettlementLine / CeresSettlementRequestLine snapshots are
// NEVER rewritten here — same immutable-snapshot philosophy the rest of Ceres already
// follows (a voided settled expense doesn't alter its settlement's historical numbers
// either). Purging a request/expense that was part of a closed settlement leaves that
// settlement's historical figures untouched; only the LIVE balance (a fresh sum over
// whatever CashMovement rows remain) reflects the purge. This is a deliberate judgment
// call for the alpha period — see the report for detail.

export type CeresTx = Prisma.TransactionClient;

export const CERES_PURGE_CONFIRM_PHRASE = 'ลบถาวร';

export class CeresPurgeError extends Error {
  constructor(
    public readonly code: 'purge_disabled' | 'confirm_mismatch' | 'not_found' | 'purge_via_request',
  ) {
    super(code);
  }
}

// Same '1'/'true' truthy convention as CERES_LOCAL_LOGIN_ENABLED (routes/ceres/login.ts).
// Default ENABLED — alpha stance; flip CERES_ALPHA_PURGE=0 before a production launch.
// Tolerates a missing/non-string value (falls back to the schema's own '1' default) so
// test files that mock env.js with a partial object — unaware of this newer key — don't
// crash instead of simply getting the default-enabled behavior.
export function alphaPurgeEnabled(value: string = env.CERES_ALPHA_PURGE ?? '1'): boolean {
  return ['1', 'true'].includes(String(value).trim().toLowerCase());
}

export function assertPurgeEnabled(): void {
  if (!alphaPurgeEnabled()) throw new CeresPurgeError('purge_disabled');
}

export function assertPurgeConfirm(confirm: unknown): void {
  if (confirm !== CERES_PURGE_CONFIRM_PHRASE) throw new CeresPurgeError('confirm_mismatch');
}

// Shared HTTP status mapping so every purge route (requests.ts, p1.ts) maps CeresPurgeError
// identically instead of re-deriving it three times.
export function purgeErrorStatus(code: CeresPurgeError['code']): number {
  switch (code) {
    case 'not_found':
      return 404;
    case 'confirm_mismatch':
      return 400;
    case 'purge_disabled':
      return 403;
    case 'purge_via_request':
      return 409;
    default:
      return 400;
  }
}

// Deletes every row hanging off ONE CeresExpense (but not the expense row itself — callers
// delete that last, after this returns, so a partial failure never leaves the expense
// present with its evidence/audit trail gone). Mirrors the tables the existing pending-draft
// hard-delete (p1.ts DELETE /api/ceres/expenses/:id) and expense void endpoint already know
// about for an expense: CeresRevision, CeresAIReview, CeresFlag, CeresMediaLink. The
// underlying CeresMedia upload-metadata row and stored blob are LEFT ALONE — the existing
// pending-draft delete never touches those either (see report), so purge matches that story.
async function purgeExpenseDependents(tx: CeresTx, expenseId: string): Promise<void> {
  await tx.ceresMediaLink.deleteMany({ where: { targetType: 'expense', targetId: expenseId } });
  await tx.ceresRevision.deleteMany({ where: { subjectType: 'expense', subjectId: expenseId } });
  await tx.ceresAIReview.deleteMany({ where: { subjectType: 'expense', subjectId: expenseId } });
  await tx.ceresFlag.deleteMany({ where: { targetType: 'expense', targetId: expenseId } });
}

// Deletes every row hanging off ONE CeresPaymentRequest (not the request row itself — same
// "dependents first, parent last" reasoning as above). Covers, per the schema survey (see
// report): CeresRequestEvent, CeresRequestMoneyEvent, the CashMovement rows those money
// events created (this is what restores the box balance — a money event's cashMovementId
// links forward, and CashMovement.requestId is the same request id, so one deleteMany by
// requestId sweeps every movement the request ever produced, including reversals), the
// CeresMediaLink rows for both the request's own request_photo evidence AND every money
// event's transfer_slip/purchase_receipt evidence (targetType 'money_event', targetId = the
// money event's own id — NOT the request id), CeresRevision, CeresAIReview, and CeresFlag.
//
// Deliberately UNTOUCHED: CeresSettlementRequestLine (immutable settlement snapshot — see
// module comment) even if it references this request/moneyEvent id; a purge leaves those
// rows dangling on purpose, matching the "snapshots are never rewritten" rule already used
// for void.
async function purgeRequestDependents(tx: CeresTx, requestId: string): Promise<void> {
  const moneyEvents = await tx.ceresRequestMoneyEvent.findMany({
    where: { requestId },
    select: { id: true },
  });
  for (const event of moneyEvents) {
    await tx.ceresMediaLink.deleteMany({ where: { targetType: 'money_event', targetId: event.id } });
  }
  // Sweeps every CashMovement this request ever produced (payments/purchases/refunds/
  // reversals all stamp requestId on write — see requestMoney.ts) in one query, restoring
  // the box balance to its pre-request value.
  await tx.cashMovement.deleteMany({ where: { requestId } });
  await tx.ceresRequestMoneyEvent.deleteMany({ where: { requestId } });
  await tx.ceresRequestEvent.deleteMany({ where: { requestId } });
  await tx.ceresMediaLink.deleteMany({ where: { targetType: 'request', targetId: requestId } });
  await tx.ceresRevision.deleteMany({ where: { subjectType: 'paymentRequest', subjectId: requestId } });
  await tx.ceresAIReview.deleteMany({ where: { subjectType: 'paymentRequest', subjectId: requestId } });
  await tx.ceresFlag.deleteMany({ where: { targetType: 'request', targetId: requestId } });
}

export interface PurgeRequestResult {
  requestId: string;
  purgedChildExpenseIds: string[];
}

// POST /api/ceres/requests/:id/purge — CEO-only, any approvalStatus/fulfillmentStatus.
// Advance cascade: liquidation children (CeresExpense.advanceRequestId = this request) are
// purged FIRST, full graph each, in the SAME transaction — an advance with children never
// leaves an orphaned expense pointing at a request that no longer exists.
export async function purgeStaffRequest(requestId: string, _agent: AuthedAgent): Promise<PurgeRequestResult> {
  assertPurgeEnabled();
  return prisma.$transaction(async (tx) => {
    // Same row-lock-first pattern every other request-mutating flow uses (recordRequestMoneyEventInTx,
    // voidStaffRequest) — protects against a concurrent decide/pay racing the purge.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CeresPaymentRequest" WHERE "id" = ${requestId} FOR UPDATE
    `;
    const existing = await tx.ceresPaymentRequest.findUnique({ where: { id: requestId } });
    if (!existing) throw new CeresPurgeError('not_found');

    // Lock every liquidation child up front too — a concurrent expense edit/approve on one
    // of them must not race the cascade.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CeresExpense" WHERE "advanceRequestId" = ${requestId} FOR UPDATE
    `;
    const children = await tx.ceresExpense.findMany({
      where: { advanceRequestId: requestId },
      select: { id: true },
    });
    for (const child of children) {
      await purgeExpenseDependents(tx, child.id);
      await tx.ceresExpense.delete({ where: { id: child.id } });
    }

    await purgeRequestDependents(tx, requestId);
    await tx.ceresPaymentRequest.delete({ where: { id: requestId } });

    return { requestId, purgedChildExpenseIds: children.map((c) => c.id) };
  });
}

// POST /api/ceres/expenses/:id/purge — CEO-only, any status. If this expense was a
// liquidation child of a live advance (advanceRequestId set, and that request still
// exists), re-sync the parent's cached fulfillmentStatus in the SAME transaction — purging
// a settled/approved child changes the live liquidation math (getAdvanceLiquidation/
// syncAdvanceLiquidationProjection both re-query CeresExpense fresh), and the parent's
// cached fulfillmentStatus column must not go stale. Mirrors the exact re-sync the void and
// edit endpoints already perform after an advance-linked expense's status changes.
export async function purgeExpense(expenseId: string, agent: AuthedAgent): Promise<{ expenseId: string }> {
  assertPurgeEnabled();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CeresExpense" WHERE "id" = ${expenseId} FOR UPDATE
    `;
    const existing = await tx.ceresExpense.findUnique({ where: { id: expenseId } });
    if (!existing) throw new CeresPurgeError('not_found');

    await purgeExpenseDependents(tx, expenseId);
    await tx.ceresExpense.delete({ where: { id: expenseId } });

    if (existing.advanceRequestId) {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "CeresPaymentRequest" WHERE "id" = ${existing.advanceRequestId} FOR UPDATE
      `;
      const advance = await tx.ceresPaymentRequest.findUnique({ where: { id: existing.advanceRequestId } });
      if (advance) await syncAdvanceLiquidationProjection(tx, advance, { id: agent.id, name: agent.name });
    }

    return { expenseId };
  });
}

// POST /api/ceres/cash/:id/purge — CEO-only. A movement created BY a request money event
// (requestId/requestMoneyEventId set) is refused — purging it alone would orphan half a
// graph (the CeresRequestMoneyEvent row would remain, pointing at a movement that no
// longer exists) — the caller must purge the REQUEST instead, which sweeps every movement
// it produced in one shot (see purgeRequestDependents). Only bare box movements (deposits,
// and legacy 'topup' rows) with no request link are ever hard-deletable here.
export async function purgeCashMovement(movementId: string, _agent: AuthedAgent): Promise<{ movementId: string }> {
  assertPurgeEnabled();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CashMovement" WHERE "id" = ${movementId} FOR UPDATE
    `;
    const existing = await tx.cashMovement.findUnique({ where: { id: movementId } });
    if (!existing) throw new CeresPurgeError('not_found');
    if (existing.requestId || existing.requestMoneyEventId) {
      throw new CeresPurgeError('purge_via_request');
    }
    await tx.cashMovement.delete({ where: { id: movementId } });
    return { movementId };
  });
}
