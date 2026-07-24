import { z } from 'zod';
import type { Role } from '../auth/jwt.js';
import { prisma } from '../db/prisma.js';
import { pushMaliLineText } from '../line/send.js';
import { callClaude } from '../llm/anthropic.js';

const distilledSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(100_000),
});

export type HumanAnswerErrorCode = 'not_found' | 'forbidden' | 'not_waiting';

export class HumanAnswerError extends Error {
  constructor(public readonly code: HumanAnswerErrorCode) {
    super(code);
  }
}

export function parseLineHumanAnswer(text: string): { questionId: string; answer: string } | null {
  const match = /^#([a-zA-Z0-9_-]+)\s+([\s\S]+)$/.exec(text.trim());
  if (!match) return null;
  const answer = match[2].trim();
  return answer ? { questionId: match[1], answer } : null;
}

async function mayAnswerQuestion(
  actor: { id: string; role: Role },
  question: { departmentId: string | null },
): Promise<boolean> {
  if (actor.role === 'supervisor') return true;
  if (!question.departmentId) return false;
  const department = await prisma.knowledgeDepartment.findUnique({
    where: { id: question.departmentId },
    select: { answererAgentIds: true },
  });
  return department?.answererAgentIds.includes(actor.id) ?? false;
}

export async function recordHumanAnswer(input: {
  questionId: string;
  answer: string;
  actor: { id: string; role: Role };
  now?: Date;
}) {
  const answer = input.answer.trim();
  if (!answer) throw new HumanAnswerError('not_waiting');
  const question = await prisma.knowledgeQuestion.findUnique({
    where: { id: input.questionId },
    select: { id: true, departmentId: true, status: true },
  });
  if (!question) throw new HumanAnswerError('not_found');
  if (!(await mayAnswerQuestion(input.actor, question))) throw new HumanAnswerError('forbidden');
  if (question.status !== 'waiting') throw new HumanAnswerError('not_waiting');

  const now = input.now ?? new Date();
  const updated = await prisma.knowledgeQuestion.updateMany({
    where: { id: question.id, status: 'waiting' },
    data: {
      status: 'answered_human',
      humanAnswer: answer,
      answererAgentId: input.actor.id,
      answeredAt: now,
    },
  });
  if (updated.count !== 1) throw new HumanAnswerError('not_waiting');
  return prisma.knowledgeQuestion.findUniqueOrThrow({ where: { id: question.id } });
}

function extractJson(raw: string): unknown {
  const object = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!object) throw new Error('distill_invalid_json');
  return JSON.parse(object);
}

function draftAudience(role: string): { audience: 'everyone' | 'gm_plus' | 'supervisor'; lineExposable: boolean } {
  if (role === 'staff') return { audience: 'everyone', lineExposable: true };
  if (role === 'gm' || role === 'central') return { audience: 'gm_plus', lineExposable: true };
  return { audience: 'supervisor', lineExposable: false };
}

export async function distillArticle(questionId: string): Promise<
  | { status: 'created' | 'existing'; articleId: string }
  | { status: 'in_progress' | 'skipped_missing_department' | 'skipped_unanswered' }
> {
  const question = await prisma.knowledgeQuestion.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      askerAgentId: true,
      questionText: true,
      humanAnswer: true,
      answererAgentId: true,
      departmentId: true,
      distilledArticleId: true,
      distillationClaimedAt: true,
    },
  });
  if (!question?.humanAnswer) return { status: 'skipped_unanswered' };
  if (question.distilledArticleId) {
    return { status: 'existing', articleId: question.distilledArticleId };
  }
  if (!question.departmentId) return { status: 'skipped_missing_department' };

  // Claim before spending LLM tokens. The article uniqueness constraint remains
  // the final persistence guard, but concurrent completions no longer both call Claude.
  const claimedAt = new Date();
  const claimed = await prisma.knowledgeQuestion.updateMany({
    where: {
      id: question.id,
      distilledArticleId: null,
      distillationClaimedAt: null,
    },
    data: { distillationClaimedAt: claimedAt },
  });
  if (claimed.count !== 1) {
    const latest = await prisma.knowledgeQuestion.findUnique({
      where: { id: question.id },
      select: { distilledArticleId: true },
    });
    return latest?.distilledArticleId
      ? { status: 'existing', articleId: latest.distilledArticleId }
      : { status: 'in_progress' };
  }

  try {
    const asker = await prisma.agent.findUnique({
      where: { id: question.askerAgentId },
      select: { role: true },
    });
    const audience = draftAudience(asker?.role ?? 'unknown');
    const raw = await callClaude(
      JSON.stringify({ question: question.questionText, humanAnswer: question.humanAnswer }),
      `สรุปคำถามและคำตอบของพนักงานให้เป็นบทความคลังความรู้ภาษาไทยที่ชัดเจนและใช้ซ้ำได้
เก็บเฉพาะข้อเท็จจริงในคำตอบ ห้ามเติมข้อมูลเอง ห้ามใส่ชื่อบุคคลหรือรายละเอียดการสนทนา
ตอบ JSON เท่านั้นในรูป {"title":"...","body":"..."}`,
      1200,
      undefined,
      { app: 'mali', feature: 'distill' },
    );
    const distilled = distilledSchema.parse(extractJson(raw));
    const article = await prisma.knowledgeArticle.create({
      data: {
        title: distilled.title,
        body: distilled.body,
        departmentId: question.departmentId,
        ...audience,
        status: 'draft',
        source: 'distilled',
        authorAgentId: question.answererAgentId ?? question.askerAgentId,
        sourceQuestionId: question.id,
      },
    });
    await prisma.knowledgeQuestion.update({
      where: { id: question.id },
      data: { distilledArticleId: article.id, distillationClaimedAt: null },
    });
    return { status: 'created', articleId: article.id };
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002') throw error;
    const existing = await prisma.knowledgeArticle.findUnique({
      where: { sourceQuestionId: question.id },
      select: { id: true },
    });
    if (!existing) throw error;
    await prisma.knowledgeQuestion.update({
      where: { id: question.id },
      data: { distilledArticleId: existing.id, distillationClaimedAt: null },
    });
    return { status: 'existing', articleId: existing.id };
  } finally {
    await prisma.knowledgeQuestion.updateMany({
      where: {
        id: question.id,
        distilledArticleId: null,
        distillationClaimedAt: claimedAt,
      },
      data: { distillationClaimedAt: null },
    });
  }
}

export async function completeHumanAnswer(questionId: string): Promise<{
  delivered: boolean;
  distill:
    | { status: 'created' | 'existing'; articleId: string }
    | { status: 'in_progress' | 'skipped_missing_department' | 'skipped_unanswered' | 'failed' };
}> {
  const question = await prisma.knowledgeQuestion.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      askerAgentId: true,
      questionText: true,
      humanAnswer: true,
      answerDeliveredAt: true,
    },
  });
  if (!question?.humanAnswer) {
    return { delivered: false, distill: { status: 'skipped_unanswered' } };
  }

  let delivered = !!question.answerDeliveredAt;
  if (!delivered) {
    const asker = await prisma.agent.findUnique({
      where: { id: question.askerAgentId },
      select: { lineUserId: true },
    });
    if (asker?.lineUserId) {
      const claimedAt = new Date();
      const claimed = await prisma.knowledgeQuestion.updateMany({
        where: { id: question.id, answerDeliveredAt: null },
        data: { answerDeliveredAt: claimedAt },
      });
      if (claimed.count !== 1) {
        // Another completion owns (or has already completed) this delivery.
        delivered = true;
      } else {
        try {
          const result = await pushMaliLineText(
            asker.lineUserId,
            `ได้คำตอบแล้วค่ะ\nคำถาม: ${question.questionText.slice(0, 1_500)}\nคำตอบ: ${question.humanAnswer.slice(0, 3_300)}`,
          );
          delivered = result.sent || result.dryRun;
          if (!delivered) {
            await prisma.knowledgeQuestion.updateMany({
              where: { id: question.id, answerDeliveredAt: claimedAt },
              data: { answerDeliveredAt: null },
            });
          }
        } catch {
          delivered = false;
          await prisma.knowledgeQuestion.updateMany({
            where: { id: question.id, answerDeliveredAt: claimedAt },
            data: { answerDeliveredAt: null },
          });
        }
      }
    }
  }

  try {
    return { delivered, distill: await distillArticle(question.id) };
  } catch {
    return { delivered, distill: { status: 'failed' } };
  }
}
