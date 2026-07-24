import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agent: {
    id: 'answerer-1',
    email: 'staff@example.test',
    name: 'Answerer',
    role: 'staff',
    apps: [],
    authVersion: 0,
  },
  articleFindMany: vi.fn(),
  articleFindUnique: vi.fn(),
  articleUpdate: vi.fn(),
  departmentFindMany: vi.fn(),
  agentFindMany: vi.fn(),
  questionFindMany: vi.fn(),
  questionFindUnique: vi.fn(),
  recordHumanAnswer: vi.fn(),
  completeHumanAnswer: vi.fn(),
  embedArticle: vi.fn(),
  deleteEmbedding: vi.fn(),
}));

vi.mock('../auth/middleware.js', () => ({
  requireAuth: async (req: { agent?: unknown }) => {
    req.agent = mocks.agent;
  },
  requireApp: () => async () => undefined,
  requireRole: (role: string) => async (
    req: { agent?: { role?: string } },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => req.agent?.role === role
    ? undefined
    : reply.code(403).send({ error: 'forbidden', need: role }),
}));
vi.mock('../db/prisma.js', () => ({
  prisma: {
    agent: { count: vi.fn(), findMany: mocks.agentFindMany },
    knowledgeArticle: {
      findMany: mocks.articleFindMany,
      findUnique: mocks.articleFindUnique,
      update: mocks.articleUpdate,
    },
    knowledgeDepartment: { findMany: mocks.departmentFindMany },
    knowledgeQuestion: {
      findMany: mocks.questionFindMany,
      findUnique: mocks.questionFindUnique,
    },
  },
}));
vi.mock('../memory/embeddings.js', () => ({
  deleteKnowledgeEmbedding: mocks.deleteEmbedding,
  embedKnowledgeArticle: mocks.embedArticle,
  knowledgeArticleEmbeddingText: (article: { title: string; body: string }) => `${article.title}\n${article.body}`,
}));
vi.mock('../mali/humanAnswer.js', () => ({
  HumanAnswerError: class HumanAnswerError extends Error {},
  recordHumanAnswer: mocks.recordHumanAnswer,
  completeHumanAnswer: mocks.completeHumanAnswer,
}));
vi.mock('../mali/routing.js', () => ({
  assignQuestionDepartment: vi.fn(),
  dispatchEscalation: vi.fn(),
}));

import { maliRoutes } from './mali.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(maliRoutes);
  return app;
}

describe('Mali admin/inbox API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agent.id = 'answerer-1';
    mocks.agent.role = 'staff';
    mocks.departmentFindMany.mockResolvedValue([{ id: 'dept-a' }]);
    mocks.questionFindMany.mockResolvedValue([{ id: 'question-1', status: 'waiting' }]);
    mocks.recordHumanAnswer.mockResolvedValue({ id: 'question-1', status: 'answered_human' });
    mocks.completeHumanAnswer.mockResolvedValue({
      delivered: true,
      distill: { status: 'created', articleId: 'draft-1' },
    });
  });

  it('lists only questions owned by departments assigned to the current answerer', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/mali/questions?status=waiting' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(mocks.departmentFindMany).toHaveBeenCalledWith({
      where: { answererAgentIds: { has: 'answerer-1' } },
      select: { id: true },
    });
    expect(mocks.questionFindMany).toHaveBeenCalledWith({
      where: { status: 'waiting', departmentId: { in: ['dept-a'] } },
      orderBy: { askedAt: 'desc' },
      take: 100,
    });
  });

  it('accepts a portal answer through the same authorization and completion service', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/mali/questions/question-1/answer',
      payload: { answer: 'คำตอบจากแผนก' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(mocks.recordHumanAnswer).toHaveBeenCalledWith({
      questionId: 'question-1',
      answer: 'คำตอบจากแผนก',
      actor: { id: 'answerer-1', role: 'staff' },
    });
    expect(mocks.completeHumanAnswer).toHaveBeenCalledWith('question-1');
  });

  it('exposes distilled drafts and failed/pending distills only to supervisors', async () => {
    mocks.agent.id = 'supervisor-1';
    mocks.agent.role = 'supervisor';
    mocks.articleFindMany.mockResolvedValue([{ id: 'draft-1' }]);
    mocks.questionFindMany.mockResolvedValue([{ id: 'question-1' }]);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/mali/review' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(mocks.articleFindMany).toHaveBeenCalledWith({
      where: { status: 'draft', source: 'distilled' },
      orderBy: { createdAt: 'asc' },
    });
    expect(mocks.questionFindMany).toHaveBeenCalledWith({
      where: { status: 'answered_human', distilledArticleId: null },
      orderBy: { answeredAt: 'asc' },
    });
  });

  it('rejects a non-supervisor from the distill review queue', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/mali/review' });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(mocks.articleFindMany).not.toHaveBeenCalled();
    expect(mocks.questionFindMany).not.toHaveBeenCalled();
  });

  it('embeds a reviewed draft only when a supervisor publishes it', async () => {
    mocks.agent.id = 'supervisor-1';
    mocks.agent.role = 'supervisor';
    mocks.articleFindUnique.mockResolvedValue({
      id: 'draft-1',
      title: 'หัวข้อ',
      body: 'เนื้อหา',
      status: 'draft',
    });
    mocks.articleUpdate.mockResolvedValue({
      id: 'draft-1',
      title: 'หัวข้อ',
      body: 'เนื้อหา',
      status: 'published',
      audience: 'everyone',
      lineExposable: true,
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/mali/articles/draft-1',
      payload: { status: 'published' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(mocks.embedArticle).toHaveBeenCalledWith('draft-1', 'หัวข้อ\nเนื้อหา');
  });
});
