import { prisma } from '../db/prisma.js';
import { findProducts } from './match.js';

const DEMOTE_AT = -3; // score at/below which a cross-sell is hidden (regularly skipped)
const PROMOTE_AT = 1; // score at/above which a learned pairing is shown first
const TARGET = 5; // aim for ~5 cross-sell options

// Build the cross-sell list for an anchor product: learned-good pairings first
// (high score), then fresh AI-suggested terms resolved to real photo'd products —
// excluding the direct matches and any demoted (regularly-skipped) pairings.
export async function buildCrossSell(
  anchorSku: string | null,
  aiTerms: string[],
  excludeSkus: Set<string>,
): Promise<string[]> {
  const out: string[] = [];
  const demoted = new Set<string>();

  if (anchorSku) {
    const links = await prisma.crossSellLink.findMany({ where: { anchorSku }, orderBy: { score: 'desc' } });
    for (const l of links) if (l.score <= DEMOTE_AT) demoted.add(l.crossSku);
    for (const l of links) {
      if (out.length >= TARGET) break;
      if (l.score >= PROMOTE_AT && !excludeSkus.has(l.crossSku) && !out.includes(l.crossSku)) {
        const p = await prisma.product.findUnique({ where: { sku: l.crossSku } });
        if (p?.photoSku && p.status === 'active') out.push(l.crossSku);
      }
    }
  }

  const usable = (sku: string, photoSku: string | null) =>
    !!photoSku && !excludeSkus.has(sku) && !out.includes(sku) && !demoted.has(sku);

  // First pass: one fresh product per AI term (variety).
  for (const term of aiTerms) {
    if (out.length >= TARGET) break;
    const hit = (await findProducts(term, 5)).find((h) => usable(h.sku, h.photoSku));
    if (hit) out.push(hit.sku);
  }
  // Second pass: top up toward TARGET with more from each term if still short.
  if (out.length < TARGET) {
    for (const term of aiTerms) {
      if (out.length >= TARGET) break;
      for (const h of await findProducts(term, 6)) {
        if (out.length >= TARGET) break;
        if (usable(h.sku, h.photoSku)) out.push(h.sku);
      }
    }
  }
  return out;
}

// Record the staff's choice for learning: strengthen cross-sells they attached,
// demote ones that were shown but skipped. Only called when staff engaged the
// picker (attached >=1 catalog photo), so a text-only reply isn't a signal.
export async function recordCrossSellOutcome(
  anchorSku: string,
  shownSkus: string[],
  chosenSkus: string[],
): Promise<void> {
  const chosen = new Set(chosenSkus);
  for (const crossSku of shownSkus) {
    const wasChosen = chosen.has(crossSku);
    await prisma.crossSellLink.upsert({
      where: { anchorSku_crossSku: { anchorSku, crossSku } },
      create: {
        anchorSku,
        crossSku,
        score: wasChosen ? 2 : -1,
        shownCount: 1,
        chosenCount: wasChosen ? 1 : 0,
      },
      update: {
        score: { increment: wasChosen ? 2 : -1 },
        shownCount: { increment: 1 },
        chosenCount: { increment: wasChosen ? 1 : 0 },
      },
    });
  }
}
