import { prisma } from '../db/prisma.js';
import { pushMaliLineText } from '../line/send.js';
import type { RetrievedKnowledgeArticle } from '../memory/embeddings.js';

const MALI_INBOX_URL = 'https://mali.prominentdental.com/?view=inbox';
const MAX_LINE_DEPARTMENT_CHOICES = 13;
const PAGED_DEPARTMENT_CHOICES = 11;

export interface DepartmentChoice {
  id: string;
  code: string;
  nameTh: string;
}

export interface PreparedEscalation {
  questionId: string;
  departmentId: string | null;
  departmentName: string | null;
  departmentChoices: DepartmentChoice[];
  routeReady: boolean;
}

export interface PrepareEscalationInput {
  askerAgentId: string;
  channel: 'line' | 'web';
  questionText: string;
  matchedArticles: RetrievedKnowledgeArticle[];
  now: Date;
}

function uniqueDepartmentIds(articles: RetrievedKnowledgeArticle[]): string[] {
  return [...new Set(articles.map((article) => article.departmentId).filter(Boolean))];
}

export function departmentPostbackData(questionId: string, departmentId: string): string {
  return `mali:department:${questionId}:${departmentId}`;
}

export function parseDepartmentPostback(data: string): { questionId: string; departmentId: string } | null {
  const match = /^mali:department:([^:]+):([^:]+)$/.exec(data);
  return match ? { questionId: match[1], departmentId: match[2] } : null;
}

export function parseDepartmentPagePostback(data: string): { questionId: string; offset: number } | null {
  const match = /^mali:department-page:([^:]+):(\d+)$/.exec(data);
  if (!match) return null;
  return { questionId: match[1], offset: Number(match[2]) };
}

export function departmentQuickReplies(escalation: PreparedEscalation, offset = 0) {
  const paged = escalation.departmentChoices.length > MAX_LINE_DEPARTMENT_CHOICES;
  const pageSize = paged ? PAGED_DEPARTMENT_CHOICES : MAX_LINE_DEPARTMENT_CHOICES;
  const safeOffset = Math.max(0, Math.min(offset, Math.max(0, escalation.departmentChoices.length - 1)));
  const replies = escalation.departmentChoices.slice(safeOffset, safeOffset + pageSize).map((department) => ({
    label: department.nameTh.slice(0, 20),
    data: departmentPostbackData(escalation.questionId, department.id),
    displayText: `ส่งต่อให้ ${department.nameTh}`,
  }));
  if (paged && safeOffset > 0) {
    replies.push({
      label: 'ก่อนหน้า',
      data: `mali:department-page:${escalation.questionId}:${Math.max(0, safeOffset - pageSize)}`,
      displayText: 'ดูแผนกก่อนหน้า',
    });
  }
  if (paged && safeOffset + pageSize < escalation.departmentChoices.length) {
    replies.push({
      label: 'ถัดไป',
      data: `mali:department-page:${escalation.questionId}:${safeOffset + pageSize}`,
      displayText: 'ดูแผนกถัดไป',
    });
  }
  return replies;
}

// Persist first, but do not push here. The webhook must spend its replyToken on
// the asker before dispatching any escalation pushes.
export async function prepareEscalation(input: PrepareEscalationInput): Promise<PreparedEscalation> {
  const departmentIds = uniqueDepartmentIds(input.matchedArticles);
  const matchedDepartments = departmentIds.length
    ? await prisma.knowledgeDepartment.findMany({
        where: { id: { in: departmentIds } },
        select: { id: true, code: true, nameTh: true },
      })
    : [];
  const departmentById = new Map(matchedDepartments.map((department) => [department.id, department]));
  const suggested = departmentIds.map((id) => departmentById.get(id)).find(Boolean) ?? null;

  const question = await prisma.knowledgeQuestion.create({
    data: {
      askerAgentId: input.askerAgentId,
      channel: input.channel,
      questionText: input.questionText,
      status: 'waiting',
      matchedArticleIds: input.matchedArticles.map((article) => article.id),
      topSimilarity: input.matchedArticles[0]?.similarity ?? null,
      departmentId: suggested?.id ?? null,
      askedAt: input.now,
    },
  });

  if (suggested) {
    return {
      questionId: question.id,
      departmentId: suggested.id,
      departmentName: suggested.nameTh,
      departmentChoices: [],
      routeReady: true,
    };
  }

  const departmentChoices = await prisma.knowledgeDepartment.findMany({
    orderBy: [{ code: 'asc' }],
    select: { id: true, code: true, nameTh: true },
  });
  return {
    questionId: question.id,
    departmentId: null,
    departmentName: null,
    departmentChoices,
    // With no configured departments, the safe generic route is the supervisor inbox.
    routeReady: departmentChoices.length === 0,
  };
}

export async function assignQuestionDepartment(
  questionId: string,
  departmentId: string,
  askerAgentId?: string,
  expectedStatus: 'waiting' | 'answered_human' = 'waiting',
): Promise<{ assigned: boolean; departmentName?: string }> {
  const department = await prisma.knowledgeDepartment.findUnique({
    where: { id: departmentId },
    select: { id: true, nameTh: true },
  });
  if (!department) return { assigned: false };

  const updated = await prisma.knowledgeQuestion.updateMany({
    where: {
      id: questionId,
      status: expectedStatus,
      departmentId: null,
      ...(askerAgentId ? { askerAgentId } : {}),
    },
    data: { departmentId },
  });
  return updated.count === 1
    ? { assigned: true, departmentName: department.nameTh }
    : { assigned: false };
}

export async function loadDepartmentPicker(
  questionId: string,
  askerAgentId: string,
): Promise<PreparedEscalation | null> {
  const question = await prisma.knowledgeQuestion.findUnique({
    where: { id: questionId },
    select: { id: true, askerAgentId: true, status: true, departmentId: true },
  });
  if (
    !question
    || question.askerAgentId !== askerAgentId
    || question.status !== 'waiting'
    || question.departmentId
  ) return null;
  const departmentChoices = await prisma.knowledgeDepartment.findMany({
    orderBy: [{ code: 'asc' }],
    select: { id: true, code: true, nameTh: true },
  });
  return {
    questionId: question.id,
    departmentId: null,
    departmentName: null,
    departmentChoices,
    routeReady: false,
  };
}

function escalationMessage(question: { id: string; questionText: string }, departmentName?: string): string {
  const departmentLine = departmentName ? `แผนก: ${departmentName}\n` : '';
  const questionContext = question.questionText.slice(0, 3_500);
  return [
    'มีคำถามรอคำตอบจากพนักงานค่ะ',
    departmentLine + `รหัส: #${question.id}`,
    `คำถาม: ${questionContext}`,
    `ตอบใน LINE ด้วย “#${question.id} คำตอบ”`,
    `หรือเปิดกล่องคำถาม: ${MALI_INBOX_URL}&question=${encodeURIComponent(question.id)}`,
  ].join('\n');
}

export async function dispatchEscalation(questionId: string): Promise<{
  targetCount: number;
  pushedCount: number;
  usedSupervisorFallback: boolean;
}> {
  const question = await prisma.knowledgeQuestion.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      askerAgentId: true,
      questionText: true,
      status: true,
      departmentId: true,
      routedAt: true,
    },
  });
  if (!question || question.status !== 'waiting' || question.routedAt) {
    return { targetCount: 0, pushedCount: 0, usedSupervisorFallback: false };
  }

  // Claim routing before any push. Only one concurrent caller may dispatch this question.
  const claimed = await prisma.knowledgeQuestion.updateMany({
    where: { id: question.id, status: 'waiting', routedAt: null },
    data: { routedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return { targetCount: 0, pushedCount: 0, usedSupervisorFallback: false };
  }

  const department = question.departmentId
    ? await prisma.knowledgeDepartment.findUnique({
        where: { id: question.departmentId },
        select: { nameTh: true, answererAgentIds: true },
      })
    : null;

  let targets = department?.answererAgentIds.length
    ? await prisma.agent.findMany({
        where: {
          id: { in: department.answererAgentIds, not: question.askerAgentId },
          lineUserId: { not: null },
        },
        select: { id: true, lineUserId: true },
      })
    : [];

  let usedSupervisorFallback = false;
  if (!targets.length) {
    usedSupervisorFallback = true;
    targets = await prisma.agent.findMany({
      where: {
        role: 'supervisor',
        id: { not: question.askerAgentId },
        lineUserId: { not: null },
      },
      select: { id: true, lineUserId: true },
    });
  }

  const uniqueTargets = [...new Map(
    targets.filter((target) => target.lineUserId).map((target) => [target.lineUserId!, target]),
  ).values()];
  const message = escalationMessage(question, department?.nameTh);
  const sends = await Promise.allSettled(
    uniqueTargets.map((target) => pushMaliLineText(target.lineUserId!, message)),
  );
  const pushedCount = sends.filter(
    (send) => send.status === 'fulfilled' && (send.value.sent || send.value.dryRun),
  ).length;

  return { targetCount: uniqueTargets.length, pushedCount, usedSupervisorFallback };
}
