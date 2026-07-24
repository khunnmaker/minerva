import Fastify, { type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentFindUnique: vi.fn(),
  sendMali: vi.fn(),
  parseBind: vi.fn(),
  handleBind: vi.fn(),
  answer: vi.fn(),
  recordHumanAnswer: vi.fn(),
  completeHumanAnswer: vi.fn(),
  parseHumanAnswer: vi.fn(),
  assignDepartment: vi.fn(),
  departmentQuickReplies: vi.fn(),
  dispatchEscalation: vi.fn(),
  loadDepartmentPicker: vi.fn(),
  parseDepartmentPagePostback: vi.fn(),
  parseDepartmentPostback: vi.fn(),
  ingestVisit: vi.fn(),
  verifySignature: vi.fn(),
  env: {
    MALI_LINE_CHANNEL_ACCESS_TOKEN: 'configured',
    MALI_LINE_CHANNEL_SECRET: 'configured',
    VENUS_VISITS_GROUP_ID: 'C-sales',
  },
}));

vi.mock('../env.js', () => ({ env: mocks.env }));
vi.mock('../db/prisma.js', () => ({ prisma: { agent: { findUnique: mocks.agentFindUnique } } }));
vi.mock('../line/send.js', () => ({ sendMaliLineText: mocks.sendMali }));
vi.mock('../line/staffBind.js', () => ({
  parseStaffBindCommand: mocks.parseBind,
  handleStaffBindCommand: mocks.handleBind,
}));
vi.mock('../line/signature.js', () => ({ verifyLineSignature: mocks.verifySignature }));
vi.mock('../mali/answer.js', () => ({ answerMaliQuestion: mocks.answer }));
vi.mock('../mali/humanAnswer.js', () => ({
  HumanAnswerError: class HumanAnswerError extends Error {},
  recordHumanAnswer: mocks.recordHumanAnswer,
  completeHumanAnswer: mocks.completeHumanAnswer,
  parseLineHumanAnswer: mocks.parseHumanAnswer,
}));
vi.mock('../mali/routing.js', () => ({
  assignQuestionDepartment: mocks.assignDepartment,
  departmentQuickReplies: mocks.departmentQuickReplies,
  dispatchEscalation: mocks.dispatchEscalation,
  loadDepartmentPicker: mocks.loadDepartmentPicker,
  parseDepartmentPagePostback: mocks.parseDepartmentPagePostback,
  parseDepartmentPostback: mocks.parseDepartmentPostback,
}));
vi.mock('../venus/visits.js', () => ({
  ingestVenusGroupMessage: mocks.ingestVisit,
}));

import { handleMaliLineEvent, maliWebhookRoutes } from './maliWebhook.js';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req: FastifyRequest, body: string | Buffer, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      req.rawBody = raw;
      done(null, raw.length ? JSON.parse(raw) : {});
    },
  );
  await app.register(maliWebhookRoutes);
  return app;
}

describe('Mali webhook event gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.MALI_LINE_CHANNEL_ACCESS_TOKEN = 'configured';
    mocks.env.MALI_LINE_CHANNEL_SECRET = 'configured';
    mocks.verifySignature.mockReturnValue(true);
    mocks.parseBind.mockReturnValue(null);
    mocks.parseHumanAnswer.mockReturnValue(null);
    mocks.departmentQuickReplies.mockReturnValue([]);
    mocks.sendMali.mockResolvedValue({ sent: true, dryRun: false });
    mocks.ingestVisit.mockResolvedValue(true);
    mocks.env.VENUS_VISITS_GROUP_ID = 'C-sales';
  });

  it('gives an unbound user only the bind prompt and never enters knowledge retrieval', async () => {
    mocks.agentFindUnique.mockResolvedValue(null);

    await handleMaliLineEvent({
      type: 'message',
      replyToken: 'reply-1',
      source: { type: 'user', userId: 'U-unbound' },
      message: { type: 'text', text: 'นโยบายวันลาคืออะไร' },
    });

    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.sendMali).toHaveBeenCalledTimes(1);
    expect(mocks.sendMali).toHaveBeenCalledWith(
      'U-unbound',
      'reply-1',
      expect.stringMatching(/ผูกบัญชี.*MALI-XXXXXXXX/),
    );
  });

  it('gives an unbound non-text sender only the bind prompt', async () => {
    mocks.agentFindUnique.mockResolvedValue(null);

    await handleMaliLineEvent({
      type: 'message',
      replyToken: 'reply-picture',
      source: { type: 'user', userId: 'U-unbound' },
      message: { type: 'image', id: 'M-picture' },
    });

    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.sendMali).toHaveBeenCalledTimes(1);
    expect(mocks.sendMali).toHaveBeenCalledWith(
      'U-unbound',
      'reply-picture',
      expect.stringMatching(/ผูกบัญชี.*MALI-XXXXXXXX/),
    );
  });

  it('routes a MALI bind command through the Mali channel before checking binding', async () => {
    mocks.parseBind.mockReturnValue({ form: 'mali', code: 'ABCDEFGH' });

    await handleMaliLineEvent({
      type: 'message',
      replyToken: 'reply-bind',
      source: { type: 'user', userId: 'U-new' },
      message: { type: 'text', text: 'MALI-ABCDEFGH' },
    });

    expect(mocks.handleBind).toHaveBeenCalledWith('MALI-ABCDEFGH', 'U-new', {
      channel: 'mali', replyToken: 'reply-bind',
    });
    expect(mocks.agentFindUnique).not.toHaveBeenCalled();
  });

  it('captures an assigned answerer LINE reply before treating it as a new question', async () => {
    mocks.agentFindUnique.mockResolvedValue({ id: 'answerer-1', role: 'staff' });
    mocks.parseHumanAnswer.mockReturnValue({ questionId: 'question-1', answer: 'คำตอบ' });
    mocks.recordHumanAnswer.mockResolvedValue({ id: 'question-1' });
    mocks.completeHumanAnswer.mockResolvedValue({
      delivered: true,
      distill: { status: 'created', articleId: 'article-1' },
    });

    await handleMaliLineEvent({
      type: 'message',
      replyToken: 'reply-answer',
      source: { type: 'user', userId: 'U-answerer' },
      message: { type: 'text', text: '#question-1 คำตอบ' },
    });

    expect(mocks.recordHumanAnswer).toHaveBeenCalledWith({
      questionId: 'question-1',
      answer: 'คำตอบ',
      actor: { id: 'answerer-1', role: 'staff' },
    });
    expect(mocks.sendMali).toHaveBeenCalledWith(
      'U-answerer',
      'reply-answer',
      expect.stringContaining('รับคำตอบแล้ว'),
    );
    expect(mocks.completeHumanAnswer).toHaveBeenCalledWith('question-1');
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it('applies a department postback only for the bound asker, replies first, then dispatches', async () => {
    mocks.agentFindUnique.mockResolvedValue({ id: 'asker-1', role: 'staff' });
    mocks.parseDepartmentPostback.mockReturnValue({
      questionId: 'question-1',
      departmentId: 'dept-a',
    });
    mocks.assignDepartment.mockResolvedValue({ assigned: true, departmentName: 'ฝ่าย ก' });
    mocks.dispatchEscalation.mockResolvedValue({
      targetCount: 1,
      pushedCount: 1,
      usedSupervisorFallback: false,
    });

    await handleMaliLineEvent({
      type: 'postback',
      replyToken: 'reply-picker',
      source: { type: 'user', userId: 'U-asker' },
      postback: { data: 'mali:department:question-1:dept-a' },
    });

    expect(mocks.assignDepartment).toHaveBeenCalledWith('question-1', 'dept-a', 'asker-1');
    expect(mocks.sendMali).toHaveBeenCalledWith(
      'U-asker',
      'reply-picker',
      expect.stringContaining('ฝ่าย ก'),
    );
    expect(mocks.sendMali.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatchEscalation.mock.invocationCallOrder[0],
    );
  });

  it('routes the configured group to Venus before the 1:1 KB lane', async () => {
    await handleMaliLineEvent({
      type: 'message',
      timestamp: 123456,
      source: { type: 'group', groupId: 'C-sales', userId: 'U-rep' },
      message: { type: 'text', id: 'M-report', text: 'รายงานเข้าพบ Sunshine' },
    });

    expect(mocks.ingestVisit).toHaveBeenCalledWith({
      groupId: 'C-sales',
      lineUserId: 'U-rep',
      lineMessageId: 'M-report',
      type: 'text',
      text: 'รายงานเข้าพบ Sunshine',
      timestamp: 123456,
    });
    expect(mocks.agentFindUnique).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it('sends a possible pending-match reply through the persist-first Venus boundary only', async () => {
    await handleMaliLineEvent({
      type: 'message',
      source: { type: 'group', groupId: 'C-sales', userId: 'U-rep' },
      message: { type: 'text', id: 'M-answer', text: '2' },
    });

    expect(mocks.ingestVisit).toHaveBeenCalledWith({
      groupId: 'C-sales', lineUserId: 'U-rep', lineMessageId: 'M-answer', type: 'text', text: '2',
    });
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it('ignores other configured groups silently', async () => {
    const info = vi.fn();
    await handleMaliLineEvent({
      type: 'message',
      source: { type: 'group', groupId: 'C-other', userId: 'U-rep' },
      message: { type: 'text', id: 'M-other', text: 'hello' },
    }, { info, error: vi.fn() } as never);

    expect(info).not.toHaveBeenCalled();
    expect(mocks.ingestVisit).not.toHaveBeenCalled();
  });

  it('logs the exact discovery line when the visits group is unconfigured', async () => {
    mocks.env.VENUS_VISITS_GROUP_ID = '';
    const info = vi.fn();
    await handleMaliLineEvent({
      type: 'message',
      source: { type: 'group', groupId: 'C-discovery', userId: 'U-rep' },
      message: { type: 'text', id: 'M-discovery', text: 'hello' },
    }, { info, error: vi.fn() } as never);

    expect(info).toHaveBeenCalledWith('VENUS_VISITS: message from unconfigured group C-discovery');
    expect(mocks.ingestVisit).not.toHaveBeenCalled();
  });
});

describe('Mali webhook route security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.MALI_LINE_CHANNEL_ACCESS_TOKEN = 'configured';
    mocks.env.MALI_LINE_CHANNEL_SECRET = 'configured';
    mocks.verifySignature.mockReturnValue(true);
    mocks.parseBind.mockReturnValue(null);
    mocks.parseHumanAnswer.mockReturnValue(null);
    mocks.departmentQuickReplies.mockReturnValue([]);
    mocks.sendMali.mockResolvedValue({ sent: true, dryRun: false });
    mocks.ingestVisit.mockResolvedValue(true);
    mocks.env.VENUS_VISITS_GROUP_ID = 'C-sales';
  });

  it('rejects an invalid signature without handling events', async () => {
    mocks.verifySignature.mockReturnValue(false);
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/mali',
      headers: { 'x-line-signature': 'invalid' },
      payload: {
        events: [{
          type: 'message',
          replyToken: 'reply-invalid',
          source: { type: 'user', userId: 'U-invalid' },
          message: { type: 'text', text: 'question' },
        }],
      },
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'invalid_signature' });
    expect(mocks.parseBind).not.toHaveBeenCalled();
    expect(mocks.handleBind).not.toHaveBeenCalled();
    expect(mocks.agentFindUnique).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.sendMali).not.toHaveBeenCalled();
  });

  it('acknowledges with no work when Mali credentials are unset', async () => {
    mocks.env.MALI_LINE_CHANNEL_ACCESS_TOKEN = '';
    mocks.env.MALI_LINE_CHANNEL_SECRET = '';
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/mali',
      payload: {
        events: [{
          type: 'message',
          replyToken: 'reply-disabled',
          source: { type: 'user', userId: 'U-disabled' },
          message: { type: 'text', text: 'question' },
        }],
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.verifySignature).not.toHaveBeenCalled();
    expect(mocks.agentFindUnique).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.sendMali).not.toHaveBeenCalled();
  });

  it('handles events with a valid signature and well-formed body', async () => {
    mocks.agentFindUnique.mockResolvedValue({ id: 'agent-1', role: 'central' });
    mocks.answer.mockResolvedValue({ status: 'answered_auto', message: 'answer', questionId: 'q-1' });
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/mali',
      headers: { 'x-line-signature': 'valid' },
      payload: {
        events: [{
          type: 'message',
          replyToken: 'reply-valid',
          source: { type: 'user', userId: 'U-valid' },
          message: { type: 'text', text: 'question' },
        }],
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.verifySignature).toHaveBeenCalledTimes(1);
    expect(mocks.agentFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.answer).toHaveBeenCalledWith({
      agent: { id: 'agent-1', role: 'central' },
      questionText: 'question',
      channel: 'line',
    });
    expect(mocks.sendMali).toHaveBeenCalledWith('U-valid', 'reply-valid', 'answer', undefined);
  });

  it('acknowledges LINE redeliveries without repeating retrieval, LLM, or sends', async () => {
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/mali',
      headers: { 'x-line-signature': 'valid' },
      payload: {
        events: [{
          type: 'message',
          webhookEventId: '01H-duplicate',
          deliveryContext: { isRedelivery: true },
          replyToken: 'reply-redelivery',
          source: { type: 'user', userId: 'U-valid' },
          message: { type: 'text', text: 'question' },
        }],
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.agentFindUnique).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.dispatchEscalation).not.toHaveBeenCalled();
    expect(mocks.sendMali).not.toHaveBeenCalled();
  });

  it('spends the reply token before dispatching a ready escalation', async () => {
    mocks.agentFindUnique.mockResolvedValue({ id: 'agent-1', role: 'staff' });
    mocks.answer.mockResolvedValue({
      status: 'waiting',
      message: 'เลือกแผนกค่ะ',
      questionId: 'question-1',
      departmentChoices: [],
      routeReady: true,
    });
    mocks.departmentQuickReplies.mockReturnValue([]);
    mocks.dispatchEscalation.mockResolvedValue({
      targetCount: 1,
      pushedCount: 1,
      usedSupervisorFallback: true,
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/mali',
      headers: { 'x-line-signature': 'valid' },
      payload: {
        events: [{
          type: 'message',
          replyToken: 'reply-waiting',
          source: { type: 'user', userId: 'U-valid' },
          message: { type: 'text', text: 'คำถามใหม่' },
        }],
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(mocks.sendMali).toHaveBeenCalledWith('U-valid', 'reply-waiting', 'เลือกแผนกค่ะ', []);
    expect(mocks.sendMali.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatchEscalation.mock.invocationCallOrder[0],
    );
  });
});
