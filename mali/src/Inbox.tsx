import { useEffect, useState } from 'react';
import { Loader2, Send, Route, AlertTriangle, Inbox as InboxIcon } from 'lucide-react';
import {
  answerQuestion,
  getAgents,
  getDepartments,
  getQuestions,
  questionStatusLabel,
  routeQuestion,
  type Agent,
  type KnowledgeDepartment,
  type KnowledgeQuestion,
  type MaliAgent,
  type QuestionStatus,
} from './lib/api';

const STATUS_TABS: QuestionStatus[] = ['waiting', 'answered_human', 'answered_auto', 'rejected'];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// คำถามรอตอบ — the answerer inbox. Supervisors see every question; department answerers see
// only the ones routed to a department they're listed on (server-side scoping, api/src/routes/
// mali.ts GET /api/mali/questions). Assigning a department (routing) is supervisor-only —
// mirrored here by only fetching /departments (also supervisor-only) and showing the assign UI
// when that agent field is filled in, so a non-supervisor never sees a broken control.
export default function Inbox({ agent }: { agent: Agent }) {
  const isSupervisor = agent.role === 'supervisor';
  const [status, setStatus] = useState<QuestionStatus>('waiting');
  const [questions, setQuestions] = useState<KnowledgeQuestion[]>([]);
  const [agents, setAgents] = useState<MaliAgent[] | null>(null);
  const [departments, setDepartments] = useState<KnowledgeDepartment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setErr(null);
    getQuestions(status)
      .then((r) => setQuestions(r.questions))
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [status]);

  // Name/department lookups are supervisor-only server routes. A non-supervisor answerer simply
  // never gets these maps populated (403, swallowed) and the UI falls back to raw IDs — it still
  // works, just less pretty, which is an acceptable trade for not exposing an admin endpoint.
  useEffect(() => {
    if (!isSupervisor) return;
    getAgents().then((r) => setAgents(r.agents)).catch(() => {});
    getDepartments().then((r) => setDepartments(r.departments)).catch(() => {});
  }, [isSupervisor]);

  const agentName = (id: string) => agents?.find((a) => a.id === id)?.name ?? id;
  const deptName = (id: string | null) => (id ? departments?.find((d) => d.id === id)?.nameTh ?? id : null);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="flex items-center gap-1.5 font-bold text-slate-800 text-[15px]">
          <InboxIcon size={17} className="text-green-600" /> คำถามรอตอบ
        </h2>
        <div className="flex-1" />
        <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                status === s ? 'bg-green-600 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {questionStatusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          โหลดไม่สำเร็จ: {err}
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-2 text-green-300 py-12 justify-center">
          <Loader2 size={20} className="animate-spin" /> กำลังโหลด…
        </div>
      ) : questions.length === 0 ? (
        <div className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
          ไม่มีคำถามในหมวดนี้
        </div>
      ) : (
        <div className="space-y-2.5">
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              isSupervisor={isSupervisor}
              departments={departments}
              agentName={agentName}
              deptName={deptName}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function QuestionCard({
  q,
  isSupervisor,
  departments,
  agentName,
  deptName,
  onChanged,
}: {
  q: KnowledgeQuestion;
  isSupervisor: boolean;
  departments: KnowledgeDepartment[] | null;
  agentName: (id: string) => string;
  deptName: (id: string | null) => string | null;
  onChanged: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
  const [routeTo, setRouteTo] = useState('');
  const [routing, setRouting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submitAnswer() {
    if (!answer.trim()) return;
    setAnswering(true);
    setErr(null);
    try {
      await answerQuestion(q.id, answer.trim());
      setAnswer('');
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setAnswering(false);
    }
  }

  async function submitRoute() {
    if (!routeTo) return;
    setRouting(true);
    setErr(null);
    try {
      await routeQuestion(q.id, routeTo);
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setRouting(false);
    }
  }

  const canAnswer = q.status === 'waiting';
  const canRoute = isSupervisor && !q.departmentId && (q.status === 'waiting' || q.status === 'answered_human');

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-1.5 flex-wrap">
        <div className="text-[11px] text-slate-400">
          {fmtDateTime(q.askedAt)} · {q.channel === 'line' ? 'LINE' : 'เว็บ'} · จาก {agentName(q.askerAgentId)}
        </div>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
          {deptName(q.departmentId) ?? 'ยังไม่ระบุแผนก'}
        </span>
      </div>
      <div className="text-[13.5px] text-slate-800 whitespace-pre-wrap mb-2">{q.questionText}</div>

      {q.humanAnswer && (
        <div className="text-[12.5px] bg-green-50 border border-green-100 rounded-lg px-3 py-2 mb-2 text-green-900">
          <span className="font-semibold">คำตอบ: </span>{q.humanAnswer}
        </div>
      )}

      {canRoute && departments && (
        <div className="flex items-center gap-2 mb-2">
          <select
            value={routeTo}
            onChange={(e) => setRouteTo(e.target.value)}
            className="text-[12.5px] border border-slate-300 rounded-lg px-2 py-1.5"
          >
            <option value="">— เลือกแผนก —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.code} · {d.nameTh}</option>
            ))}
          </select>
          <button
            onClick={submitRoute}
            disabled={!routeTo || routing}
            className="inline-flex items-center gap-1 text-[12.5px] font-bold px-2.5 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
          >
            {routing ? <Loader2 size={13} className="animate-spin" /> : <Route size={13} />} มอบหมายแผนก
          </button>
        </div>
      )}

      {canAnswer && (
        <div className="flex items-start gap-2">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="พิมพ์คำตอบ…"
            rows={2}
            className="flex-1 text-[13px] border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
          />
          <button
            onClick={submitAnswer}
            disabled={answering || !answer.trim()}
            className="inline-flex items-center gap-1 text-[12.5px] font-bold px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 shrink-0"
          >
            {answering ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} ตอบ
          </button>
        </div>
      )}

      {err && (
        <div className="flex items-center gap-1 text-rose-600 text-xs mt-2">
          <AlertTriangle size={13} /> {err}
        </div>
      )}
    </div>
  );
}
