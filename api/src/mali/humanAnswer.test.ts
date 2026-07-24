import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  questionFindUnique: vi.fn(),
  questionFindUniqueOrThrow: vi.fn(),
  questionUpdateMany: vi.fn(),
  questionUpdate: vi.fn(),
  departmentFindUnique: vi.fn(),
  agentFindUnique: vi.fn(),
  articleCreate: vi.fn(),
  articleFindUnique: vi.fn(),
  kbEntryCreate: vi.fn(),
  callClaude: vi.fn(),
  pushMali: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    knowledgeQuestion: {
      findUnique: mocks.questionFindUnique,
      findUniqueOrThrow: mocks.questionFindUniqueOrThrow,
      updateMany: mocks.questionUpdateMany,
      update: mocks.questionUpdate,
    },
    knowledgeDepartment: { findUnique: mocks.departmentFindUnique },
    knowledgeArticle: {
      create: mocks.articleCreate,
      findUnique: mocks.articleFindUnique,
    },
    kbEntry: { create: mocks.kbEntryCreate },
    agent: { findUnique: mocks.agentFindUnique },
  },
}));
vi.mock('../llm/anthropic.js', () => ({ callClaude: mocks.callClaude }));
vi.mock('../line/send.js', () => ({ pushMaliLineText: mocks.pushMali }));

import {
  completeHumanAnswer,
  distillArticle,
  HumanAnswerError,
  parseLineHumanAnswer,
  recordHumanAnswer,
} from './humanAnswer.js';

const waitingQuestion = {
  id: 'question-1',
  departmentId: 'dept-a',
  status: 'waiting',
};

const answeredQuestion = {
  id: 'question-1',
  askerAgentId: 'asker-1',
  questionText: 'เบิกของอย่างไร',
  humanAnswer: 'กรอกแบบฟอร์มแล้วส่งให้หัวหน้า',
  answererAgentId: 'answerer-1',
  departmentId: 'dept-a',
  distilledArticleId: null,
};

describe('Mali human-answer and distill lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.questionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.questionUpdate.mockResolvedValue({});
    mocks.questionFindUniqueOrThrow.mockResolvedValue({ ...answeredQuestion, status: 'answered_human' });
    mocks.articleCreate.mockResolvedValue({ id: 'article-draft-1' });
    mocks.pushMali.mockResolvedValue({ sent: true, dryRun: false });
    mocks.callClaude.mockResolvedValue(JSON.stringify({
      title: 'วิธีเบิกของ',
      body: 'กรอกแบบฟอร์มแล้วส่งให้หัวหน้า',
    }));
  });

  it('parses the explicit LINE #question answer format', () => {
    expect(parseLineHumanAnswer('#question-1 คำตอบที่ถูกต้อง')).toEqual({
      questionId: 'question-1',
      answer: 'คำตอบที่ถูกต้อง',
    });
    expect(parseLineHumanAnswer('คำตอบที่ไม่มีรหัส')).toBeNull();
  });

  it('allows a configured department answerer and claims the waiting row atomically', async () => {
    mocks.questionFindUnique.mockResolvedValue(waitingQuestion);
    mocks.departmentFindUnique.mockResolvedValue({ answererAgentIds: ['answerer-1'] });

    await recordHumanAnswer({
      questionId: 'question-1',
      answer: 'คำตอบ',
      actor: { id: 'answerer-1', role: 'staff' },
      now: new Date('2026-07-24T01:00:00Z'),
    });

    expect(mocks.questionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'question-1', status: 'waiting' },
      data: expect.objectContaining({
        status: 'answered_human',
        humanAnswer: 'คำตอบ',
        answererAgentId: 'answerer-1',
      }),
    });
  });

  it('rejects an unassigned non-supervisor without mutating the question', async () => {
    mocks.questionFindUnique.mockResolvedValue(waitingQuestion);
    mocks.departmentFindUnique.mockResolvedValue({ answererAgentIds: ['someone-else'] });

    await expect(recordHumanAnswer({
      questionId: 'question-1',
      answer: 'คำตอบ',
      actor: { id: 'answerer-1', role: 'staff' },
    })).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<HumanAnswerError>);
    expect(mocks.questionUpdateMany).not.toHaveBeenCalled();
  });

  it('pushes the answer to the asker and creates a draft Mali article with distill usage tagging', async () => {
    mocks.questionFindUnique
      .mockResolvedValueOnce({ ...answeredQuestion, answerDeliveredAt: null })
      .mockResolvedValueOnce(answeredQuestion);
    mocks.agentFindUnique
      .mockResolvedValueOnce({ lineUserId: 'U-asker' })
      .mockResolvedValueOnce({ role: 'staff' });

    const result = await completeHumanAnswer('question-1');

    expect(result).toEqual({
      delivered: true,
      distill: { status: 'created', articleId: 'article-draft-1' },
    });
    expect(mocks.pushMali).toHaveBeenCalledWith(
      'U-asker',
      expect.stringMatching(/เบิกของอย่างไร[\s\S]*กรอกแบบฟอร์ม/),
    );
    expect(mocks.questionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'question-1', answerDeliveredAt: null },
      data: { answerDeliveredAt: expect.any(Date) },
    });
    expect(mocks.questionUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pushMali.mock.invocationCallOrder[0],
    );
    expect(mocks.callClaude).toHaveBeenCalledWith(
      expect.stringContaining('"question":"เบิกของอย่างไร"'),
      expect.any(String),
      1200,
      undefined,
      { app: 'mali', feature: 'distill' },
    );
    expect(mocks.articleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'draft',
        source: 'distilled',
        audience: 'everyone',
        lineExposable: true,
        sourceQuestionId: 'question-1',
      }),
    });
    expect(mocks.kbEntryCreate).not.toHaveBeenCalled();
  });

  it('does not push the answer when another completion already claimed delivery', async () => {
    mocks.questionFindUnique
      .mockResolvedValueOnce({ ...answeredQuestion, answerDeliveredAt: null })
      .mockResolvedValueOnce({ ...answeredQuestion, distilledArticleId: 'article-existing' });
    mocks.agentFindUnique.mockResolvedValue({ lineUserId: 'U-asker' });
    mocks.questionUpdateMany.mockResolvedValue({ count: 0 });

    const result = await completeHumanAnswer('question-1');

    expect(result).toEqual({
      delivered: true,
      distill: { status: 'existing', articleId: 'article-existing' },
    });
    expect(mocks.pushMali).not.toHaveBeenCalled();
  });

  it('claims distillation before the LLM and skips token spend when already claimed', async () => {
    mocks.questionFindUnique
      .mockResolvedValueOnce(answeredQuestion)
      .mockResolvedValueOnce({ distilledArticleId: null });
    mocks.questionUpdateMany.mockResolvedValue({ count: 0 });

    await expect(distillArticle('question-1')).resolves.toEqual({ status: 'in_progress' });

    expect(mocks.questionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'question-1',
        distilledArticleId: null,
        distillationClaimedAt: null,
      },
      data: { distillationClaimedAt: expect.any(Date) },
    });
    expect(mocks.agentFindUnique).not.toHaveBeenCalled();
    expect(mocks.callClaude).not.toHaveBeenCalled();
    expect(mocks.articleCreate).not.toHaveBeenCalled();
  });

  it('forces supervisor-tier distilled drafts to portal-only and never publishes automatically', async () => {
    mocks.questionFindUnique.mockResolvedValue(answeredQuestion);
    mocks.agentFindUnique.mockResolvedValue({ role: 'supervisor' });

    await distillArticle('question-1');

    expect(mocks.articleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'draft',
        audience: 'supervisor',
        lineExposable: false,
      }),
    });
  });

  it('leaves an unrouted answered question visible for curator retry instead of inventing a department', async () => {
    mocks.questionFindUnique.mockResolvedValue({ ...answeredQuestion, departmentId: null });
    const result = await distillArticle('question-1');

    expect(result).toEqual({ status: 'skipped_missing_department' });
    expect(mocks.callClaude).not.toHaveBeenCalled();
    expect(mocks.articleCreate).not.toHaveBeenCalled();
  });
});
