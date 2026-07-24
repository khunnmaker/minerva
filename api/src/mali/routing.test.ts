import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  departmentFindMany: vi.fn(),
  departmentFindUnique: vi.fn(),
  questionCreate: vi.fn(),
  questionFindUnique: vi.fn(),
  questionUpdateMany: vi.fn(),
  agentFindMany: vi.fn(),
  pushMali: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    knowledgeDepartment: {
      findMany: mocks.departmentFindMany,
      findUnique: mocks.departmentFindUnique,
    },
    knowledgeQuestion: {
      create: mocks.questionCreate,
      findUnique: mocks.questionFindUnique,
      updateMany: mocks.questionUpdateMany,
    },
    agent: { findMany: mocks.agentFindMany },
  },
}));
vi.mock('../line/send.js', () => ({ pushMaliLineText: mocks.pushMali }));

import {
  assignQuestionDepartment,
  departmentQuickReplies,
  dispatchEscalation,
  loadDepartmentPicker,
  parseDepartmentPagePostback,
  parseDepartmentPostback,
  prepareEscalation,
} from './routing.js';

const article = {
  id: 'article-1',
  title: 'ขั้นตอน',
  body: 'เนื้อหา',
  departmentId: 'dept-ops',
  audience: 'everyone',
  lineExposable: true,
  similarity: 0.4,
};

describe('Mali escalation routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.questionCreate.mockResolvedValue({ id: 'question-1' });
    mocks.questionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.pushMali.mockResolvedValue({ sent: true, dryRun: false });
  });

  it('uses the best retrieved article department without hardcoded department names', async () => {
    mocks.departmentFindMany.mockResolvedValue([
      { id: 'dept-ops', code: 'OPS-X', nameTh: 'ฝ่ายทดลอง' },
    ]);

    const result = await prepareEscalation({
      askerAgentId: 'asker-1',
      channel: 'line',
      questionText: 'ทำอย่างไร',
      matchedArticles: [article],
      now: new Date('2026-07-24T00:00:00Z'),
    });

    expect(result).toEqual(expect.objectContaining({
      departmentId: 'dept-ops',
      departmentName: 'ฝ่ายทดลอง',
      routeReady: true,
    }));
    expect(mocks.questionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ departmentId: 'dept-ops', status: 'waiting' }),
    });
    expect(mocks.pushMali).not.toHaveBeenCalled();
  });

  it('returns data-driven quick replies when the owning department is unclear', async () => {
    mocks.departmentFindMany.mockResolvedValue([
      { id: 'dept-a', code: 'A', nameTh: 'ฝ่าย ก' },
      { id: 'dept-b', code: 'B', nameTh: 'ฝ่าย ข' },
    ]);

    const result = await prepareEscalation({
      askerAgentId: 'asker-1',
      channel: 'line',
      questionText: 'คำถามใหม่',
      matchedArticles: [],
      now: new Date(),
    });
    const replies = departmentQuickReplies(result);

    expect(result.routeReady).toBe(false);
    expect(replies).toHaveLength(2);
    expect(parseDepartmentPostback(replies[1].data)).toEqual({
      questionId: 'question-1',
      departmentId: 'dept-b',
    });
  });

  it('paginates a department list without dropping data beyond LINE quick-reply limits', () => {
    const escalation = {
      questionId: 'question-1',
      departmentId: null,
      departmentName: null,
      departmentChoices: Array.from({ length: 15 }, (_, index) => ({
        id: `dept-${index}`,
        code: `D${index}`,
        nameTh: `ฝ่าย ${index}`,
      })),
      routeReady: false,
    };
    const firstPage = departmentQuickReplies(escalation);
    const next = firstPage.at(-1)!;
    const page = parseDepartmentPagePostback(next.data);
    const secondPage = departmentQuickReplies(escalation, page!.offset);

    expect(firstPage).toHaveLength(12);
    expect(page).toEqual({ questionId: 'question-1', offset: 11 });
    expect(secondPage.some((reply) => reply.data.includes('dept-14'))).toBe(true);
    expect(secondPage).toHaveLength(5);
  });

  it('marks an unconfigured question ready for the generic supervisor route', async () => {
    mocks.departmentFindMany.mockResolvedValue([]);
    const result = await prepareEscalation({
      askerAgentId: 'asker-1',
      channel: 'line',
      questionText: 'คำถามใหม่',
      matchedArticles: [],
      now: new Date(),
    });
    expect(result.routeReady).toBe(true);
    expect(result.departmentChoices).toEqual([]);
  });

  it('pushes department answerers and stamps the routing audit time', async () => {
    mocks.questionFindUnique.mockResolvedValue({
      id: 'question-1',
      askerAgentId: 'asker-1',
      questionText: 'คำถาม',
      status: 'waiting',
      departmentId: 'dept-a',
    });
    mocks.departmentFindUnique.mockResolvedValue({
      nameTh: 'ฝ่าย ก',
      answererAgentIds: ['answerer-1', 'answerer-2'],
    });
    mocks.agentFindMany.mockResolvedValue([
      { id: 'answerer-1', lineUserId: 'U-answerer-1' },
      { id: 'answerer-2', lineUserId: 'U-answerer-2' },
    ]);

    const result = await dispatchEscalation('question-1');

    expect(result).toEqual({ targetCount: 2, pushedCount: 2, usedSupervisorFallback: false });
    expect(mocks.pushMali).toHaveBeenCalledTimes(2);
    expect(mocks.pushMali).toHaveBeenCalledWith(
      'U-answerer-1',
      expect.stringMatching(/#question-1[\s\S]*mali\.prominentdental\.com/),
    );
    expect(mocks.questionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'question-1', status: 'waiting', routedAt: null },
      data: { routedAt: expect.any(Date) },
    });
    expect(mocks.questionUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pushMali.mock.invocationCallOrder[0],
    );
  });

  it('does not push when another caller already claimed routing', async () => {
    mocks.questionFindUnique.mockResolvedValue({
      id: 'question-1',
      askerAgentId: 'asker-1',
      questionText: 'คำถาม',
      status: 'waiting',
      departmentId: 'dept-a',
      routedAt: null,
    });
    mocks.questionUpdateMany.mockResolvedValue({ count: 0 });

    await expect(dispatchEscalation('question-1')).resolves.toEqual({
      targetCount: 0,
      pushedCount: 0,
      usedSupervisorFallback: false,
    });
    expect(mocks.departmentFindUnique).not.toHaveBeenCalled();
    expect(mocks.agentFindMany).not.toHaveBeenCalled();
    expect(mocks.pushMali).not.toHaveBeenCalled();
  });

  it('falls back to bound supervisors when a department has no reachable answerer', async () => {
    mocks.questionFindUnique.mockResolvedValue({
      id: 'question-1',
      askerAgentId: 'asker-1',
      questionText: 'คำถาม',
      status: 'waiting',
      departmentId: 'dept-empty',
    });
    mocks.departmentFindUnique.mockResolvedValue({
      nameTh: 'ฝ่ายว่าง',
      answererAgentIds: [],
    });
    mocks.agentFindMany.mockResolvedValue([
      { id: 'supervisor-1', lineUserId: 'U-supervisor' },
    ]);

    const result = await dispatchEscalation('question-1');

    expect(result.usedSupervisorFallback).toBe(true);
    expect(mocks.agentFindMany).toHaveBeenCalledWith({
      where: {
        role: 'supervisor',
        id: { not: 'asker-1' },
        lineUserId: { not: null },
      },
      select: { id: true, lineUserId: true },
    });
    expect(mocks.pushMali).toHaveBeenCalledWith('U-supervisor', expect.any(String));
  });

  it('assigns a picker choice only to the waiting question owned by that asker', async () => {
    mocks.departmentFindUnique.mockResolvedValue({ id: 'dept-a', nameTh: 'ฝ่าย ก' });
    const result = await assignQuestionDepartment('question-1', 'dept-a', 'asker-1');

    expect(result).toEqual({ assigned: true, departmentName: 'ฝ่าย ก' });
    expect(mocks.questionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'question-1',
        status: 'waiting',
        departmentId: null,
        askerAgentId: 'asker-1',
      },
      data: { departmentId: 'dept-a' },
    });
  });

  it('loads later picker pages only for the still-waiting question owner', async () => {
    mocks.questionFindUnique.mockResolvedValue({
      id: 'question-1',
      askerAgentId: 'asker-1',
      status: 'waiting',
      departmentId: null,
    });
    mocks.departmentFindMany.mockResolvedValue([
      { id: 'dept-a', code: 'A', nameTh: 'ฝ่าย ก' },
    ]);

    await expect(loadDepartmentPicker('question-1', 'asker-1')).resolves.toEqual(
      expect.objectContaining({ questionId: 'question-1', departmentChoices: [expect.any(Object)] }),
    );
    await expect(loadDepartmentPicker('question-1', 'other-asker')).resolves.toBeNull();
  });
});
