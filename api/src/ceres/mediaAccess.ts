import { z } from 'zod';
import type { AuthedAgent } from '../auth/jwt.js';
import { prisma } from '../db/prisma.js';

export const CERES_MEDIA_PURPOSES = [
  'legacy_receipt',
  'request_photo',
  'reimbursement_receipt',
  'purchase_receipt',
  'transfer_slip',
  'refund_slip',
] as const;

export const ceresMediaPurposeSchema = z.enum(CERES_MEDIA_PURPOSES);
export type CeresMediaPurpose = z.infer<typeof ceresMediaPurposeSchema>;

type MediaRow = Awaited<ReturnType<typeof prisma.ceresMedia.findUnique>>;

export function isCeresManager(agent: Pick<AuthedAgent, 'role'>): boolean {
  return agent.role === 'gm' || agent.role === 'supervisor';
}

// Staff may attach only uploads they created. Managers retain the existing ability
// to enter expenses for another party, including attaching a freshly uploaded file.
export async function mediaCanBeAttachedBy(
  mediaId: string,
  agent: AuthedAgent,
  allowedPurposes: readonly CeresMediaPurpose[],
): Promise<NonNullable<MediaRow> | null> {
  const media = await prisma.ceresMedia.findUnique({ where: { id: mediaId } });
  if (!media || !allowedPurposes.includes(media.purpose as CeresMediaPurpose)) return null;
  if (isCeresManager(agent) || media.uploadedById === agent.id) return media;
  return null;
}

// A media URL is issued only to management, its uploader, or the owner of a linked
// expense/request. This also keeps migrated legacy receipts readable by their owner.
export async function mediaVisibleToAgent(mediaId: string, agent: AuthedAgent): Promise<NonNullable<MediaRow> | null> {
  const media = await prisma.ceresMedia.findUnique({ where: { id: mediaId } });
  if (!media) return null;
  if (isCeresManager(agent) || media.uploadedById === agent.id) return media;

  const ownParty = await prisma.ceresParty.findFirst({ where: { agentEmail: agent.email }, select: { id: true } });
  const expense = await prisma.ceresExpense.findFirst({
    where: {
      receiptUploadId: mediaId,
      OR: [
        { enteredById: agent.id },
        ...(ownParty ? [{ partyId: ownParty.id }] : []),
      ],
    },
    select: { id: true },
  });
  if (expense) return media;

  const request = await prisma.ceresPaymentRequest.findFirst({
    where: { requestPhotoUploadId: mediaId, requestedById: agent.id },
    select: { id: true },
  });
  if (request) return media;

  const moneyEvent = await prisma.ceresRequestMoneyEvent.findFirst({
    where: {
      OR: [
        { transferSlipUploadId: mediaId },
        { purchaseReceiptUploadId: mediaId },
      ],
    },
    select: { requestId: true },
  });
  if (!moneyEvent) return null;
  const owningRequest = await prisma.ceresPaymentRequest.findFirst({
    where: { id: moneyEvent.requestId, requestedById: agent.id },
    select: { id: true },
  });
  return owningRequest ? media : null;
}
