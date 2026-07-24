import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Role } from '../auth/jwt.js';
import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { handleStaffBindCommand, parseStaffBindCommand } from '../line/staffBind.js';
import { sendMaliLineText } from '../line/send.js';
import { verifyLineSignature } from '../line/signature.js';
import { answerMaliQuestion } from '../mali/answer.js';
import {
  completeHumanAnswer,
  HumanAnswerError,
  parseLineHumanAnswer,
  recordHumanAnswer,
} from '../mali/humanAnswer.js';
import {
  assignQuestionDepartment,
  departmentQuickReplies,
  dispatchEscalation,
  loadDepartmentPicker,
  parseDepartmentPagePostback,
  parseDepartmentPostback,
} from '../mali/routing.js';
import { ingestVenusGroupMessage } from '../venus/visits.js';

const MAX_EVENTS = 50;
const BIND_PROMPT = 'ผูกบัญชีก่อนนะคะ กรุณาเข้า Portal แล้วไปที่เมนูผูก LINE เพื่อรับรหัส จากนั้นส่ง MALI-XXXXXXXX มาที่นี่ค่ะ';
const TEXT_ONLY_MESSAGE = 'รองรับเฉพาะข้อความค่ะ';

interface MaliLineMessage {
  type: string;
  text?: string;
  id?: string;
}

export interface MaliLineEvent {
  type: string;
  replyToken?: string;
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
  message?: MaliLineMessage;
  postback?: { data?: string };
  source?: { type: string; userId?: string; groupId?: string };
  timestamp?: number;
}

interface MaliWebhookBody {
  events?: MaliLineEvent[];
}

// Exported as a small event boundary so fail-closed/binding behavior can be
// tested without booting the whole API process.
export async function handleMaliLineEvent(
  ev: MaliLineEvent,
  log?: Pick<FastifyBaseLogger, 'error' | 'info'>,
): Promise<void> {
  // LINE retries an entire webhook batch when the original request times out.
  // Retried events have unusable reply tokens and must not repeat LLM work or pushes.
  if (ev.deliveryContext?.isRedelivery === true) return;

  // Venus sales-group lane must stay ahead of Mali's 1:1 KB gate. Group content
  // never reaches binding, retrieval, or answer generation.
  if (ev.type === 'message' && ev.message && ev.source?.type === 'group') {
    const groupId = ev.source.groupId;
    if (!groupId) return;
    if (!env.VENUS_VISITS_GROUP_ID) {
      log?.info(`VENUS_VISITS: message from unconfigured group ${groupId}`);
      return;
    }
    if (groupId !== env.VENUS_VISITS_GROUP_ID) return;
    const lineUserId = ev.source.userId;
    const lineMessageId = ev.message.id;
    if (!lineUserId || !lineMessageId) return;
    if (ev.message.type !== 'text' && ev.message.type !== 'image') return;

    await ingestVenusGroupMessage({
      groupId,
      lineUserId,
      lineMessageId,
      type: ev.message.type,
      ...(ev.message.type === 'text' ? { text: ev.message.text ?? '' } : {}),
      ...(ev.timestamp ? { timestamp: ev.timestamp } : {}),
    });
    return;
  }

  const lineUserId = ev.source?.type === 'user' ? ev.source.userId : undefined;
  if (!lineUserId) return;

  const respond = (text: string) => sendMaliLineText(lineUserId, ev.replyToken, text);
  if (ev.type === 'postback') {
    const agent = await prisma.agent.findUnique({
      where: { lineUserId },
      select: { id: true, role: true },
    });
    if (!agent) {
      await respond(BIND_PROMPT);
      return;
    }
    const selection = parseDepartmentPostback(ev.postback?.data ?? '');
    if (!selection) {
      const page = parseDepartmentPagePostback(ev.postback?.data ?? '');
      if (!page) return;
      const picker = await loadDepartmentPicker(page.questionId, agent.id);
      if (!picker) {
        await respond('ไม่สามารถเปิดรายการแผนกของคำถามนี้ได้ค่ะ');
        return;
      }
      await sendMaliLineText(
        lineUserId,
        ev.replyToken,
        'กรุณาเลือกแผนกค่ะ',
        departmentQuickReplies(picker, page.offset),
      );
      return;
    }
    const assigned = await assignQuestionDepartment(
      selection.questionId,
      selection.departmentId,
      agent.id,
    );
    if (!assigned.assigned) {
      await respond('ไม่สามารถเลือกแผนกให้คำถามนี้ได้ค่ะ อาจมีผู้รับเรื่องไปแล้ว');
      return;
    }
    let responseError: unknown;
    try {
      await respond(`ส่งต่อให้แผนก ${assigned.departmentName ?? ''} แล้วค่ะ`);
    } catch (error) {
      responseError = error;
    }
    await dispatchEscalation(selection.questionId);
    if (responseError) throw responseError;
    return;
  }

  if (ev.type !== 'message' || !ev.message) return;
  const text = ev.message.type === 'text' ? ev.message.text?.trim() ?? '' : '';
  const bind = text ? parseStaffBindCommand(text) : null;
  if (bind?.form === 'mali') {
    await handleStaffBindCommand(text, lineUserId, { channel: 'mali', replyToken: ev.replyToken });
    return;
  }

  const agent = await prisma.agent.findUnique({
    where: { lineUserId },
    select: { id: true, role: true },
  });
  if (!agent) {
    await respond(BIND_PROMPT);
    return;
  }

  if (ev.message.type !== 'text') {
    await respond(TEXT_ONLY_MESSAGE);
    return;
  }

  if (!text) {
    await respond('กรุณาส่งคำถามเป็นข้อความนะคะ');
    return;
  }

  const humanAnswer = parseLineHumanAnswer(text);
  if (humanAnswer) {
    try {
      const question = await recordHumanAnswer({
        questionId: humanAnswer.questionId,
        answer: humanAnswer.answer,
        actor: { id: agent.id, role: agent.role as Role },
      });
      let responseError: unknown;
      try {
        await respond('รับคำตอบแล้วค่ะ กำลังส่งกลับให้ผู้ถามและทำร่างบทความนะคะ');
      } catch (error) {
        responseError = error;
      }
      await completeHumanAnswer(question.id);
      if (responseError) throw responseError;
    } catch (error) {
      if (error instanceof HumanAnswerError) {
        await respond('ไม่สามารถรับคำตอบนี้ได้ค่ะ กรุณาตรวจรหัสคำถามและสิทธิ์ผู้ตอบ');
        return;
      }
      throw error;
    }
    return;
  }

  try {
    const result = await answerMaliQuestion({
      agent: { id: agent.id, role: agent.role as Role },
      questionText: text,
      channel: 'line',
    });
    let responseError: unknown;
    try {
      await sendMaliLineText(
        lineUserId,
        ev.replyToken,
        result.message,
        result.status === 'waiting' ? departmentQuickReplies({
          questionId: result.questionId,
          departmentId: null,
          departmentName: null,
          departmentChoices: result.departmentChoices,
          routeReady: result.routeReady,
        }) : undefined,
      );
    } catch (error) {
      responseError = error;
    }
    if (result.status === 'waiting' && result.routeReady) {
      await dispatchEscalation(result.questionId);
    }
    if (responseError) throw responseError;
  } catch (err) {
    log?.error({ err }, 'failed to answer Mali question');
  }
}

export async function maliWebhookRoutes(app: FastifyInstance) {
  app.post('/webhook/mali', async (req, reply) => {
    // The channel is optional at boot. If either credential is absent, acknowledge
    // every delivery and perform no signature work, DB lookup, or send.
    if (!env.MALI_LINE_CHANNEL_ACCESS_TOKEN || !env.MALI_LINE_CHANNEL_SECRET) {
      return reply.code(200).send({ ok: true });
    }

    const signature = req.headers['x-line-signature'] as string | undefined;
    if (!verifyLineSignature(req.rawBody ?? '', signature, env.MALI_LINE_CHANNEL_SECRET)) {
      req.log.warn('rejected Mali webhook: invalid X-Line-Signature');
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const allEvents = ((req.body ?? {}) as MaliWebhookBody).events ?? [];
    if (allEvents.length > MAX_EVENTS) {
      req.log.warn(`Mali webhook batch of ${allEvents.length} events capped to ${MAX_EVENTS}`);
    }
    for (const event of allEvents.slice(0, MAX_EVENTS)) {
      try {
        await handleMaliLineEvent(event, req.log);
      } catch (err) {
        req.log.error({ err }, 'failed to process Mali LINE event');
      }
    }
    return reply.code(200).send({ ok: true });
  });
}
