// Typed API client for the Ceres petty-cash UI. Talks to the SHARED Minerva Fastify
// backend (the /api/ceres/* routes — see api/src/routes/ceres/p1.ts, common.ts, index.ts).
// Raw auth roles (Agent table): 'messenger' | 'md' | 'supervisor' (+ other non-Ceres
// roles like 'agent'). GET /api/ceres/bootstrap normalizes that into the Ceres role
// vocabulary 'messenger' | 'md' | 'ceo' ('supervisor' -> 'ceo') — always trust the
// bootstrap role for UI routing/branching, never the raw login role.

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// Raw Agent-table role as returned by POST /api/auth/login.
export type Role = 'messenger' | 'md' | 'supervisor';
export interface Agent {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const TOKEN_KEY = 'ceres_token';
const AGENT_KEY = 'ceres_agent';

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

// Notified on a 401 (daily JWT expiry) so the app can drop back to Login instead of sitting
// as a dead husk of failed fetches. Set by App.tsx.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(fn: (() => void) | null): void { onUnauthorized = fn; }

// Thrown by authed() on a non-2xx response. Carries the parsed JSON error body (when
// the response was JSON) so call sites that need to branch on {error, ...} — e.g.
// POST /close's 409 {error:'already_closed_today'} / {error:'pending_exist', pendingCount}
// — don't have to re-fetch or guess. Falls back to `null` body for non-JSON responses.
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearSession();
    onUnauthorized?.();
    throw new ApiError('unauthorized', 401, null);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const code = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new ApiError(code, res.status, body);
  }
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<{ token: string; agent: Agent }> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError('invalid_credentials', res.status, null);
  return res.json() as Promise<{ token: string; agent: Agent }>;
}

function queryString(q: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface Category {
  id: string;
  name: string;
  kind: string;
  ceiling: number | null;
  needsCustomerNote: boolean;
  active: boolean;
  sortOrder: number;
}
export interface Party {
  id: string;
  name: string;
  kind: string;
  agentEmail: string | null;
  active: boolean;
  sortOrder: number;
}
export interface Bootstrap {
  role: 'messenger' | 'md' | 'ceo';
  agent: { id: string; name: string };
  party: { id: string; name: string } | null;
  categories: Category[];
  parties: Party[];
  entities: string[]; // ['PROM','DENL']
  floor: number;
  ceoThreshold: number;
}
export const getBootstrap = () => authed<Bootstrap>('/api/ceres/bootstrap');

export interface LoginName {
  email: string;
  name: string;
}
// PUBLIC — no auth required.
export const getLogins = () => fetch(`${API_URL}/api/ceres/logins`).then((r) => r.json() as Promise<LoginName[]>);

export interface OcrResult {
  amount: string;
  vendor: string;
  dateText: string;
}
export const uploadReceipt = (dataB64: string, contentType: string) =>
  authed<{ uploadId: string; url: string; ocr: OcrResult }>('/api/ceres/receipts', {
    method: 'POST',
    body: JSON.stringify({ dataB64, contentType }),
  });

export type ExpenseStatus = 'pending' | 'approved' | 'settled' | 'rejected';
export interface Expense {
  id: string;
  partyId: string | null;
  partyName: string;
  enteredById: string | null;
  enteredByName: string;
  entity: string;
  category: string;
  customerNote: string;
  amount: string;
  amountNum: number;
  spentAt: string;
  receiptUploadId: string | null;
  receiptUrl: string | null;
  ocrAmount: string;
  ocrVendor: string;
  ocrDate: string;
  status: ExpenseStatus;
  approvedById: string | null;
  approvedAt: string | null;
  rejectReason: string;
  settlementId: string | null;
  aiVerdict: string;
  note: string;
  createdAt: string;
}

export const createExpense = (body: {
  entity: string;
  category: string;
  customerNote?: string;
  amount: string;
  receiptUploadId?: string;
  note?: string;
  partyId?: string;
}) => authed<{ expense: Expense }>('/api/ceres/expenses', { method: 'POST', body: JSON.stringify(body) });

export const listExpenses = (q: {
  scope?: 'mine' | 'all';
  status?: ExpenseStatus;
  from?: string;
  to?: string;
  partyId?: string;
}) => authed<{ expenses: Expense[] }>(`/api/ceres/expenses${queryString(q)}`);

export const updateExpense = (
  id: string,
  body: Partial<{
    entity: string;
    category: string;
    customerNote: string;
    amount: string;
    receiptUploadId: string;
    note: string;
    reason: string;
  }>,
) => authed<{ expense: Expense }>(`/api/ceres/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteExpense = (id: string) => authed<{ ok: boolean }>(`/api/ceres/expenses/${id}`, { method: 'DELETE' });
export const approveExpense = (id: string) => authed<{ expense: Expense }>(`/api/ceres/expenses/${id}/approve`, { method: 'POST' });
export const rejectExpense = (id: string, reason: string) =>
  authed<{ expense: Expense }>(`/api/ceres/expenses/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });

export interface Movement {
  id: string;
  accountId: string;
  type: string;
  partyId: string | null;
  partyName: string | null;
  entity: string;
  amount: string;
  note: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export const createAdvance = (body: { partyId: string; amount: string; entity?: string; note?: string }) =>
  authed<{ movement: Movement }>('/api/ceres/advances', { method: 'POST', body: JSON.stringify(body) });
export const createRefund = (body: { partyId: string; amount: string; note?: string }) =>
  authed<{ movement: Movement }>('/api/ceres/refunds', { method: 'POST', body: JSON.stringify(body) });
export const createMovement = (body: { type: 'deposit' | 'topup'; amount: string; note?: string }) =>
  authed<{ movement: Movement }>('/api/ceres/movements', { method: 'POST', body: JSON.stringify(body) });

export const listMovements = (q: { from?: string; to?: string; type?: string }) =>
  authed<{ movements: Movement[] }>(`/api/ceres/movements${queryString(q)}`);

export interface PartyBoard {
  partyId: string;
  partyName: string;
  active: boolean;
  outstandingBefore: number;
  advancesSince: number;
  refundsSince: number;
  approvedSince: number;
  pendingCount: number;
  pendingSum: number;
  expectedChange: number;
}
export interface Board {
  dayKey: string;
  box: { balance: number; floor: number; belowFloor: boolean; suggestedTopup: number };
  sinceSettlementId: string | null;
  parties: PartyBoard[];
}
export const getBoard = () => authed<Board>('/api/ceres/board');

// closeDay surfaces its 409 body via ApiError.body (see authed()'s error handling above)
// so callers can branch on {error:'already_closed_today'} vs {error:'pending_exist', pendingCount}.
export const closeDay = (note?: string) =>
  authed<{ settlement: Settlement }>('/api/ceres/close', { method: 'POST', body: JSON.stringify({ note }) });

export interface SettlementLine {
  partyName: string;
  advances: string;
  expenses: string;
  refunds: string;
  outstanding: string;
}
export interface Settlement {
  id: string;
  dayKey: string;
  closedByName: string;
  boxBefore: string;
  boxAfter: string;
  note: string;
  createdAt: string;
  lines: SettlementLine[];
}
export const listSettlements = (limit?: number) =>
  authed<{ settlements: Settlement[] }>(`/api/ceres/settlements${limit ? `?limit=${limit}` : ''}`);

// Baht formatting for display.
export const baht = (n: number): string =>
  `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
