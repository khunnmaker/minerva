import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../auth/middleware.js';
import type { Role } from '../auth/jwt.js';

// Jupiter — the portal's badges endpoint. Returns pending-work counts ONLY for the
// apps the caller's role may enter (never leak a count for an app the caller can't
// open). Phase 1: no SSO, any authenticated account, today's localStorage-JWT auth.
// See docs/JUPITER_BRIEF.md §5.
//
// Role→app "who may enter" map (mirrors the actual route gates in the suite):
//   - Minerva (web/)   : agent + supervisor      → /api/queue, requireAuth only
//   - Vulcan  (vulcan/): supervisor only         → /api/stock/*, requireRole('supervisor')
//   - Juno    (juno/)  : supervisor only         → /api/juno/*,  requireRole('supervisor')
//   - Ceres   (ceres/) : messenger + md + CEO    → inert in Phase 1 (roles not in auth yet)
//
// The auth layer today only issues 'agent' | 'supervisor' (see auth/jwt.ts). The Ceres
// roles (messenger/md) don't exist in the JWT yet, so a Ceres badge is only emitted for a
// caller whose role can actually enter Ceres — which for now is only the CEO (supervisor).
// When Ceres' own roles land, extend CERES_ENTER without touching the other badges.

// A tiny in-process cache keyed by the shape of counts a role can see. Badges are a
// glance-level hint (a small number on a tile), not an authoritative figure, so a ~30s
// staleness is fine and spares the DB a burst of count() queries when the whole team
// opens the portal at once. Cache is per-role-bucket, never per-user (counts are global).
const CACHE_TTL_MS = 30_000;

type BadgeBucket = { minerva?: { pending: number }; juno?: { toVerify: number }; vulcan?: { lowStock: number }; ceres?: { awaitingAction: number } };
const cache = new Map<string, { at: number; value: BadgeBucket }>();

// Which apps each role may ENTER. Keep this the single source of truth for gating so a
// count is computed only when the caller can open the app it belongs to.
const MINERVA_ENTER: Role[] = ['agent', 'supervisor'];
const VULCAN_ENTER: Role[] = ['supervisor'];
const JUNO_ENTER: Role[] = ['supervisor'];
// Ceres today: only the CEO (supervisor) role exists in auth; messenger/md land later.
const CERES_ENTER: Role[] = ['supervisor'];

// Minerva "pending" = customers whose LATEST message is a customer message that is still
// awaiting a reply (after any "ตอบแล้ว" answeredThroughAt cutoff). This mirrors the
// /api/queue waiting filter (console.ts) but as a single set-based count instead of
// loading every customer + newest message into JS. The correlated subquery finds each
// active customer's newest message once (indexed on Message.customerId).
async function minervaPending(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n
    FROM "Customer" c
    WHERE c.active = true
      AND EXISTS (
        SELECT 1 FROM "Message" m
        WHERE m."customerId" = c.id
          AND m.role = 'customer'
          AND (c."answeredThroughAt" IS NULL OR m."createdAt" > c."answeredThroughAt")
          AND m."createdAt" = (
            SELECT max(m2."createdAt") FROM "Message" m2 WHERE m2."customerId" = c.id
          )
      )`;
  return Number(rows[0]?.n ?? 0);
}

// Vulcan low-stock = active products at/below their reorder point. Column-vs-column
// compare → raw SQL (same query the Vulcan summary uses in stock.ts).
async function vulcanLowStock(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "Product"
    WHERE status = 'active' AND stock IS NOT NULL AND "reorderPoint" IS NOT NULL
      AND stock <= "reorderPoint"`;
  return Number(rows[0]?.n ?? 0);
}

// Juno to-verify = Payment rows still in 'received' (not yet verified). Indexed on status.
async function junoToVerify(): Promise<number> {
  return prisma.payment.count({ where: { status: 'received' } });
}

export async function jupiterRoutes(app: FastifyInstance) {
  // GET /api/jupiter/badges — pending-work counts, gated to the apps this role can enter.
  app.get('/api/jupiter/badges', { preHandler: requireAuth }, async (req) => {
    const role = req.agent!.role;

    const cached = cache.get(role);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    // Compute ONLY the badges this role may see; an app the role can't enter is never queried.
    const [pending, lowStock, toVerify] = await Promise.all([
      MINERVA_ENTER.includes(role) ? minervaPending() : Promise.resolve(null),
      VULCAN_ENTER.includes(role) ? vulcanLowStock() : Promise.resolve(null),
      JUNO_ENTER.includes(role) ? junoToVerify() : Promise.resolve(null),
    ]);

    const value: BadgeBucket = {};
    if (pending !== null) value.minerva = { pending };
    if (lowStock !== null) value.vulcan = { lowStock };
    if (toVerify !== null) value.juno = { toVerify };
    // Ceres: no queryable expense table in Phase 1 (Ceres schema/roles not live yet). Only a
    // Ceres-eligible role would get a Ceres key at all; even then there is nothing to count
    // today, so it is omitted rather than reported as a misleading 0. Wire the count in when
    // Ceres' tables + roles ship (extend CERES_ENTER above).
    void CERES_ENTER;

    cache.set(role, { at: Date.now(), value });
    return value;
  });
}
