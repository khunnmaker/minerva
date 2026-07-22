# Ceres — alpha hard-purge (CEO-only, alpha period only)

Owner directive (2026-07-22): "as this is still alpha test I want ability to cleanse each
entry like it hasn't happened before." This is CEO-only tooling for the alpha test period —
it does NOT replace the existing void flow, and it must be switched off before Ceres goes
into real production use.

## What it is, vs. void

Ceres already has a **void** flow (`POST /api/ceres/requests/:id/void`,
`POST /api/ceres/expenses/:id/void`) — a soft-delete: the row stays forever, struck-through,
excluded from every total/board/settlement, with who/when/why recorded. That is the
permanent, production-safe "I need to remove this" tool and stays exactly as it is.

**Purge is different and more dangerous.** It HARD-DELETES the row and everything hanging
off it, in one transaction — no audit trail is written on purpose. The point is "like it
never happened," which is only an acceptable thing to want during alpha testing (cleaning up
bad test data), never once real money is flowing.

## The kill-switch

Env var `CERES_ALPHA_PURGE` (see `api/src/env.ts`, `api/src/ceres/purge.ts`):

- `'1'` / `'true'` (**default**) — purge endpoints are live, and the CEO's `ลบถาวร (ทดสอบ)`
  buttons render in the UI (gated on the bootstrap flag `alphaPurgeEnabled`, itself gated on
  this env var — see `GET /api/ceres/bootstrap`).
- anything else (e.g. `'0'`) — every purge endpoint returns `403 {"error":"purge_disabled"}`
  regardless of role, and the UI hides every purge button (even for the CEO).

### Production-launch step

**Set `CERES_ALPHA_PURGE=0` before Ceres goes live for real.** This is the one required
step to retire this feature safely — nothing else needs to change; the void flow, which
stays production-safe forever, is completely unaffected either way.

## Endpoints (all CEO-only — `requireCeresRole('ceo')`)

All three take `POST { confirm: "ลบถาวร" }` — the confirm string must equal that exact Thai
phrase or the server 400s `confirm_mismatch`. All three work from **any** status
(pending/approved/settled/rejected/void/in-flight) — alpha stance, matching the owner's
"cleanse each entry" ask.

| Endpoint | Deletes |
|---|---|
| `POST /api/ceres/requests/:id/purge` | A `CeresPaymentRequest` and its entire graph (see below), plus every liquidation child (`CeresExpense.advanceRequestId = this id`), full graph each — same transaction. |
| `POST /api/ceres/expenses/:id/purge` | A `CeresExpense` and its own dependents. If it was a liquidation child of a still-existing advance, the parent's cached `fulfillmentStatus` is re-synced in the same transaction (mirrors what `/void` and edit already do). |
| `POST /api/ceres/cash/:id/purge` | A single `CashMovement` row — **only** if it wasn't created by a request money event (`requestId`/`requestMoneyEventId` both null). A request-linked movement 409s `purge_via_request`, telling the caller to purge the request instead — the request purge sweeps every movement it produced in one shot, so a movement is never orphaned. |

## What gets deleted (schema survey)

Every table that references a `CeresPaymentRequest`/`CeresExpense`/`CashMovement` id, per a
full read of `api/prisma/schema.prisma`:

- **CeresRequestEvent** (`requestId`) — request timeline
- **CeresRequestMoneyEvent** (`requestId`) — payment/purchase/refund/reversal events
- **CashMovement** (`requestId`, `requestMoneyEventId`) — every movement a request's money
  events produced (this is what restores the box balance)
- **CeresMediaLink** — both `(targetType:'request', targetId:<requestId>)` (request-photo
  evidence) and `(targetType:'money_event', targetId:<moneyEventId>)` for every money event
  (transfer-slip/purchase-receipt evidence); `(targetType:'expense', targetId:<expenseId>)`
  for an expense's receipt
- **CeresRevision** (`subjectType:'paymentRequest'|'expense'`, `subjectId`)
- **CeresAIReview** (`subjectType:'paymentRequest'|'expense'`, `subjectId`)
- **CeresFlag** (`targetType:'request'|'expense'`, `targetId`)
- **CeresExpense** (`advanceRequestId`) — advance liquidation children, cascaded

**Deliberately left alone** — the immutable-snapshot tables:

- **CeresSettlementLine** / **CeresSettlementRequestLine** — a closed day's settlement
  snapshot. Ceres already treats these as permanent historical record, never rewritten even
  when an expense inside them is later voided (see the void endpoints' own comments); purge
  follows the identical rule. If a purged request/expense had already been swept into a
  closed settlement, that settlement's historical figures stay exactly as they were —
  `CeresSettlementRequestLine.requestId`/`moneyEventId` may now point at nothing. This is a
  deliberate judgment call, not an oversight: the alternative (rewriting closed settlements)
  would break the append-only/immutable-snapshot philosophy the rest of Ceres money already
  relies on. Only the **live** balance (a fresh sum over whatever `CashMovement` rows remain)
  reflects the purge.
- **CeresMedia** (upload metadata) and the underlying stored blob — the existing pending-draft
  hard-delete (`DELETE /api/ceres/expenses/:id`) already never touches these either, so purge
  matches that story rather than introducing new blob-deletion behavior. The `CeresMediaLink`
  *pointer* rows are deleted; the media metadata + file are left on disk.

## Deletion order (inside one transaction, row-locked first)

1. `SELECT ... FOR UPDATE` on the target row (and, for a request purge, on its liquidation
   children too) — same lock-first pattern every other request-mutating flow uses
   (`recordRequestMoneyEventInTx`, `voidStaffRequest`), so a purge can never race a concurrent
   decide/pay.
2. For a request purge, each liquidation child first: its media links → revisions → AI
   reviews → flags → the expense row itself.
3. The request's own dependents: each money event's media links, then every `CashMovement`
   the request produced (one `deleteMany` by `requestId`), then the money events themselves,
   then the request's own timeline events, its own media links, revisions, AI reviews, flags.
4. The request row itself, last.

(Expense-only purge is the same shape without steps 2/3's request-specific parts: media
links → revisions → AI reviews → flags → the expense row → optional parent re-sync.)

## Frontend

- **ประวัติ** (`ceres/src/MdHistory.tsx`) — both expense and request rows get a red
  `ลบถาวร (ทดสอบ)` button, CEO-only, only when the bootstrap flag is on.
- **RequestDetail** (`ceres/src/RequestDetail.tsx`) — the same button in the detail view, so
  an in-flight test request (never reaches ประวัติ, which only shows *finished* requests) is
  purgeable too.
- **MdMoney** (ฝากเงิน) — the button on deposit rows only (never on advance/refund/
  request_payment/reversal rows, which are always request-linked and would just 409).
- Confirmation: `window.prompt` asking the user to type `ลบถาวร` exactly; the typed value IS
  the `confirm` body field. Cancel or a wrong string aborts client-side (no request sent).

## Judgment calls / things to know

- **Settlement snapshots go stale on purpose** — see above. This is the single biggest
  "gotcha": after purging an entry that was part of a closed day, that day's settlement
  numbers no longer reconcile against the live ledger. Acceptable for alpha test cleanup;
  never acceptable in production, which is exactly why the kill-switch exists.
- **Purging a liquidation-child expense re-syncs its parent's `fulfillmentStatus`** even
  though the task only explicitly asked for the cascade in the *request*-purge direction.
  Without this, purging a settled/approved child through the *expense* purge endpoint would
  leave the parent advance's cached status stale (e.g. still reading "settled" after its
  only liquidating expense is gone). This mirrors what `/void` and the expense edit endpoint
  already do for the same column.
- **No audit row anywhere, ever, by design** — this is the one thing that makes purge
  different from every other destructive action in Ceres. Don't add one "just in case"; if
  audit is ever wanted, it changes the alpha-purge philosophy and should be a fresh decision.
