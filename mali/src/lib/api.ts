// Typed API client for the Mali (มะลิ) staff knowledge-base UI. Talks to the SHARED api
// Fastify backend's /api/mali/* routes (api/src/routes/mali.ts). Mali is an ALL-STAFF app —
// every authenticated agent passes requireApp('mali') server-side (api/src/auth/jwt.ts
// hasAppAccess special-cases 'mali' → true) — article `audience` + department scoping do the
// real gating, enforced by the server on every read/write. This client mirrors that scoping in
// the UI (hide admin controls from non-supervisors) but never relies on hiding alone; every
// mutating call still gets its real answer (200/403/409/...) from the server.

import { fetchWithSessionRenewal, renewSuiteSessionOnce } from '@pantheon/ui';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// Live roles (mirror of api/src/auth/jwt.ts Role).
export type Role = 'supervisor' | 'gm' | 'central' | 'staff';
export interface Agent {
  id: string;
  email: string;
  name: string;
  role: Role;
  // Per-person app grants (from the login response). Drives the suite app switcher — see
  // hasAppAccess below, which mirrors the SERVER logic in api/src/auth/jwt.ts exactly,
  // including the 'mali' all-staff special case.
  apps: string[];
}

// Suite apps the switcher can link to. The canonical list lives in the shared package
// (@pantheon/ui, mirroring the server SSOT api/src/auth/jwt.ts APP_NAMES). Imported for local
// use below AND re-exported so existing consumers that import AppName from './lib/api' keep
// working unchanged.
import type { AppName } from '@pantheon/ui';
export type { AppName };

// Mirror of the server's hasAppAccess (api/src/auth/jwt.ts): Mali is all-staff (any active
// Agent passes — a knowledge base everyone can't read defeats its purpose); otherwise
// supervisor → everything; gm → Ceres + Minerva + Juno + Apollo; central/staff → their own
// per-person grant list.
export function hasAppAccess(agent: Agent, app: AppName): boolean {
  if (app === 'mali') return true;
  if (agent.role === 'supervisor') return true;
  if (agent.role === 'gm') return app === 'ceres' || app === 'minerva' || app === 'juno' || app === 'apollo';
  return (agent.apps ?? []).includes(app);
}

const TOKEN_KEY = 'mali_token';
const AGENT_KEY = 'mali_agent';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredAgent(): Agent | null {
  const s = localStorage.getItem(AGENT_KEY);
  if (!s) return null;
  try {
    return JSON.parse(s) as Agent;
  } catch {
    clearSession();
    return null;
  }
}
export function setSession(token: string, agent: Agent): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(AGENT_KEY, JSON.stringify(agent));
}
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AGENT_KEY);
}

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(fn: (() => void) | null): void { onUnauthorized = fn; }

async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithSessionRenewal<Agent>(
    `${API_URL}${path}`,
    { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } },
    { apiUrl: API_URL, getToken, setSession },
  );
  if (res.status === 401) {
    // Session expired/invalid. Clear it so App re-boots into the Login screen — without this
    // the UI stays "logged in" and every action just fails.
    clearSession();
    onUnauthorized?.();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
    throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<{ token: string; agent: Agent }> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    // Suite SSO: let the browser STORE the parent-domain httpOnly cookie the server sets
    // on this response. Only login/bootstrap/logout use credentials — never state-changing calls.
    credentials: 'include',
  });
  if (!res.ok) throw new Error('invalid_credentials');
  return res.json() as Promise<{ token: string; agent: Agent }>;
}

// Suite SSO bootstrap: with NO stored token, ask /me using ONLY the shared parent-domain
// cookie (credentials:'include', no Authorization header). Never throws — a missing/invalid
// cookie just yields null (→ show Login).
export async function bootstrap(): Promise<Agent | null> {
  try {
    const session = await renewSuiteSessionOnce<Agent>(API_URL);
    if (!session) return null;
    setSession(session.token, session.agent);
    return session.agent;
  } catch {
    return null;
  }
}

// Suite-wide logout: clear the shared cookie server-side (best-effort), THEN clear this app's
// local session.
export async function logout(): Promise<void> {
  const token = getToken();
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } catch {
    // Network failure clearing the cookie shouldn't block local logout.
  }
  clearSession();
}

export interface LoginCard {
  email: string;
  name: string;
  kind: 'password' | 'pin';
  group: string;
  gender: 'male' | 'female';
}
// PUBLIC — no auth required. Ordered: supervisor first, then staff granted this app.
export async function getLogins(): Promise<LoginCard[]> {
  const res = await fetch(`${API_URL}/api/auth/logins?app=mali`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<LoginCard[]>;
}

// ── Mali domain types (mirror api/prisma/schema.prisma + api/src/routes/mali.ts) ──────────

export type Audience = 'everyone' | 'gm_plus' | 'supervisor';
export type ArticleStatus = 'draft' | 'published' | 'archived';
export type ArticleSource = 'seed' | 'distilled' | 'manual';
export type QuestionStatus = 'answered_auto' | 'waiting' | 'answered_human' | 'rejected';

export interface KnowledgeArticle {
  id: string;
  title: string;
  body: string;
  departmentId: string;
  audience: Audience;
  lineExposable: boolean;
  status: ArticleStatus;
  source: ArticleSource;
  authorAgentId: string;
  sourceQuestionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDepartment {
  id: string;
  code: string;
  nameTh: string;
  answererAgentIds: string[];
}

export interface KnowledgeQuestion {
  id: string;
  askerAgentId: string;
  channel: 'line' | 'web';
  questionText: string;
  status: QuestionStatus;
  matchedArticleIds: string[];
  topSimilarity: number | null;
  departmentId: string | null;
  answererAgentId: string | null;
  humanAnswer: string | null;
  distilledArticleId: string | null;
  askedAt: string;
  answeredAt: string | null;
  routedAt: string | null;
  answerDeliveredAt: string | null;
}

export interface MaliAgent {
  id: string;
  name: string;
  email: string;
  role: Role;
  lineBound: boolean;
}

const AUDIENCE_LABEL: Record<Audience, string> = {
  everyone: 'ทุกคน',
  gm_plus: 'GM ขึ้นไป',
  supervisor: 'หัวหน้าเท่านั้น',
};
export const audienceLabel = (a: Audience): string => AUDIENCE_LABEL[a] ?? a;

const STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: 'ร่าง',
  published: 'เผยแพร่แล้ว',
  archived: 'เก็บถาวร',
};
export const articleStatusLabel = (s: ArticleStatus): string => STATUS_LABEL[s] ?? s;

const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  waiting: 'รอตอบ',
  answered_auto: 'ตอบอัตโนมัติ',
  answered_human: 'ตอบแล้ว (คน)',
  rejected: 'ปฏิเสธ',
};
export const questionStatusLabel = (s: QuestionStatus): string => QUESTION_STATUS_LABEL[s] ?? s;

// ── Articles (คลังบทความ) ───────────────────────────────────────────────
// GET is open to every authenticated agent — server filters by role/audience/status. all=1
// (supervisor only, server-enforced) also returns archived articles.
export const getArticles = (all?: boolean) =>
  authed<{ articles: KnowledgeArticle[] }>(`/api/mali/articles${all ? '?all=1' : ''}`);

export interface ArticleInput {
  title: string;
  body: string;
  departmentId: string;
  audience?: Audience;
  lineExposable?: boolean;
  status?: ArticleStatus;
  source?: ArticleSource;
  sourceQuestionId?: string | null;
}

export const createArticle = (body: ArticleInput) =>
  authed<{ article: KnowledgeArticle }>('/api/mali/articles', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateArticle = (id: string, body: Partial<ArticleInput>) =>
  authed<{ article: KnowledgeArticle }>(`/api/mali/articles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

// Soft-delete (archives + drops the embedding). The server route is a DELETE that returns the
// archived article, not a 204 — named archiveArticle here for clarity at call sites.
export const archiveArticle = (id: string) =>
  authed<{ article: KnowledgeArticle }>(`/api/mali/articles/${id}`, { method: 'DELETE' });

// ── Departments + answerer roster (แผนกและผู้ตอบ) — supervisor only ───────
export const getDepartments = () =>
  authed<{ departments: KnowledgeDepartment[] }>('/api/mali/departments');

export interface DepartmentInput {
  code: string;
  nameTh: string;
  answererAgentIds: string[];
}

export const createDepartment = (body: DepartmentInput) =>
  authed<{ department: KnowledgeDepartment }>('/api/mali/departments', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateDepartment = (id: string, body: Partial<DepartmentInput>) =>
  authed<{ department: KnowledgeDepartment }>(`/api/mali/departments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteDepartment = (id: string) =>
  authed<{ ok: true }>(`/api/mali/departments/${id}`, { method: 'DELETE' });

// Staff picker for assigning answerers — never exposes LINE user IDs, only whether one is bound.
export const getAgents = () => authed<{ agents: MaliAgent[] }>('/api/mali/agents');

// ── Questions / inbox (คำถามรอตอบ) ──────────────────────────────────────
// Supervisor sees everything; any other agent sees only questions routed to a department
// where they're a listed answerer (server-side scoping — see api/src/routes/mali.ts).
export const getQuestions = (status?: QuestionStatus) =>
  authed<{ questions: KnowledgeQuestion[] }>(
    `/api/mali/questions${status ? `?status=${status}` : ''}`,
  );

// Records the human answer, relays it to the asker's LINE, and kicks off distillation.
// 403 when the caller isn't a supervisor or an answerer assigned to the question's department.
export const answerQuestion = (id: string, answer: string) =>
  authed<{
    question: KnowledgeQuestion;
    completion: { delivered: boolean; distill: { status: string; articleId?: string } };
  }>(`/api/mali/questions/${id}/answer`, {
    method: 'POST',
    body: JSON.stringify({ answer }),
  });

// Supervisor-only: assign/re-route an unrouted (or department-less answered) question.
export const routeQuestion = (id: string, departmentId: string) =>
  authed<{ assigned: { assigned: boolean; departmentName?: string }; dispatch: unknown }>(
    `/api/mali/questions/${id}/route`,
    { method: 'POST', body: JSON.stringify({ departmentId }) },
  );

// ── Review queue (ตรวจร่างบทความ) — supervisor only ─────────────────────
export const getReview = () =>
  authed<{ articles: KnowledgeArticle[]; pendingDistillQuestions: KnowledgeQuestion[] }>(
    '/api/mali/review',
  );

// Retry distillation for an answered-but-not-yet-distilled question (e.g. after it's finally
// assigned a department, or a prior distill attempt failed).
export const retryDistill = (questionId: string) =>
  authed<{ completion: { status: string; articleId?: string } }>(
    `/api/mali/questions/${questionId}/distill`,
    { method: 'POST' },
  );
