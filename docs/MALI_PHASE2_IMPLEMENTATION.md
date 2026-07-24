# Mali Phase 2 implementation notes

Implemented on the `mali-phase2` worktree from `docs/MALI_PLAN.md` Phase 2. Phase 5 group-listener
work remains out of scope; the existing Venus group-ingestion lane is unchanged.

## Escalation behavior

- A confidence-gate failure creates a `KnowledgeQuestion` before any send.
- If the best retrieved article has a valid department, Mali replies to the asker first and then
  pushes every bound answerer assigned to that department.
- If ownership is unclear, the LINE reply contains department postbacks generated from
  `KnowledgeDepartment` rows. The postback can assign only the still-waiting question owned by
  that bound asker.
- If there are no departments, or a department has no reachable answerer, bound supervisors are
  the generic fallback. There are no built-in department names or answerer IDs.
- Answerer pushes include the question, its full `#questionId` reply syntax, and a Mali inbox
  deep link.

## Human-answer and curation behavior

- LINE answers use `#<questionId> <answer>`. Portal answers use
  `POST /api/mali/questions/:id/answer`.
- Only a supervisor or an answerer currently assigned to the question's department may answer.
  The transition from `waiting` to `answered_human` is an atomic conditional update.
- Mali pushes the answer to the asker's bound LINE account, then calls the Sonnet-class default
  model with `TokenUsage` metadata `{ app: "mali", feature: "distill" }`.
- Distillation creates only a `KnowledgeArticle(status="draft", source="distilled")`; it never
  publishes or writes Minerva `KbEntry`. One source question can have only one draft article.
- Draft audience defaults to the asker's tier. Supervisor-tier drafts are forced portal-only.
  A supervisor publishes through the existing article update API, which creates the isolated
  `knowledge_embedding`.
- An answered question without a department stays in the review response as pending distillation;
  assign a department and retry `POST /api/mali/questions/:id/distill`.

## Phase 3 API surface

- `GET /api/mali/agents` — supervisor staff picker; exposes `lineBound`, never LINE user IDs.
- `GET|POST|PUT|DELETE /api/mali/departments...` — supervisor department and answerer management.
- `GET /api/mali/questions?status=waiting` — supervisor sees all; answerers see assigned departments.
- `POST /api/mali/questions/:id/route` — supervisor assigns an unrouted waiting question.
- `POST /api/mali/questions/:id/answer` — authorized answer capture, relay, and distill.
- `POST /api/mali/questions/:id/distill` — supervisor retry for answer delivery and a pending distill.
- `GET /api/mali/review` — distilled drafts plus answered questions still missing a draft.
