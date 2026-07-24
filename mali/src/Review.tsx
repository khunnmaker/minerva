import { useEffect, useState } from 'react';
import { Loader2, Check, Archive, RefreshCw, AlertTriangle, FileEdit } from 'lucide-react';
import {
  archiveArticle,
  audienceLabel,
  getDepartments,
  getReview,
  retryDistill,
  routeQuestion,
  updateArticle,
  type KnowledgeArticle,
  type KnowledgeDepartment,
  type KnowledgeQuestion,
} from './lib/api';

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ตรวจร่างบทความ — the distill review queue (supervisor only, mirrors the server's GET
// /api/mali/review). Two sections: drafts already produced by distillArticle() awaiting
// edit+publish, and answered questions that never got distilled (usually because they had no
// department yet — assign one here and retry).
export default function Review() {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [pending, setPending] = useState<KnowledgeQuestion[]>([]);
  const [departments, setDepartments] = useState<KnowledgeDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setErr(null);
    Promise.all([getReview(), getDepartments()])
      .then(([r, d]) => {
        setArticles(r.articles);
        setPending(r.pendingDistillQuestions);
        setDepartments(d.departments);
      })
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const deptName = (id: string | null) => (id ? departments.find((d) => d.id === id)?.nameTh ?? id : null);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-green-300 py-12 justify-center">
        <Loader2 size={20} className="animate-spin" /> กำลังโหลด…
      </div>
    );
  }

  return (
    <section className="space-y-6">
      {err && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          โหลดไม่สำเร็จ: {err}
        </div>
      )}

      <div>
        <h2 className="flex items-center gap-1.5 font-bold text-slate-800 text-[15px] mb-3">
          <FileEdit size={17} className="text-green-600" /> ร่างบทความรอตรวจ
          <span className="text-slate-400 font-normal text-[12.5px]">· {articles.length} ฉบับ</span>
        </h2>
        {articles.length === 0 ? (
          <div className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
            ไม่มีร่างรอตรวจ
          </div>
        ) : (
          <div className="space-y-3">
            {articles.map((a) => (
              <DraftCard key={a.id} article={a} deptName={deptName} onChanged={load} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-bold text-slate-800 text-[15px] mb-3">
          คำถามที่ตอบแล้วแต่ยังไม่สรุปเป็นบทความ
          <span className="text-slate-400 font-normal text-[12.5px]"> · {pending.length} รายการ</span>
        </h2>
        {pending.length === 0 ? (
          <div className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
            ไม่มีรายการค้าง
          </div>
        ) : (
          <div className="space-y-2.5">
            {pending.map((q) => (
              <PendingCard key={q.id} q={q} departments={departments} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DraftCard({
  article,
  deptName,
  onChanged,
}: {
  article: KnowledgeArticle;
  deptName: (id: string | null) => string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(article.title);
  const [body, setBody] = useState(article.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(status?: 'published') {
    setBusy(true);
    setErr(null);
    try {
      await updateArticle(article.id, { title, body, ...(status ? { status } : {}) });
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    setErr(null);
    try {
      await archiveArticle(article.id);
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2 text-[11px] text-slate-400">
        <span className="font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{deptName(article.departmentId) ?? 'ไม่ระบุแผนก'}</span>
        <span>{audienceLabel(article.audience)}</span>
        <span>·</span>
        <span>{article.source === 'distilled' ? 'สรุปจากคำตอบ' : article.source === 'seed' ? 'ตั้งต้น' : 'พิมพ์เอง'}</span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full font-bold text-[14px] border border-slate-300 rounded-lg px-3 py-1.5"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full text-[13px] border border-slate-300 rounded-lg px-3 py-2"
          />
        </div>
      ) : (
        <>
          <div className="font-bold text-[14px] text-slate-800 mb-1">{article.title}</div>
          <div className="text-[13px] text-slate-600 whitespace-pre-wrap">{article.body}</div>
        </>
      )}

      {err && (
        <div className="flex items-center gap-1 text-rose-600 text-xs mt-2">
          <AlertTriangle size={13} /> {err}
        </div>
      )}

      <div className="flex gap-2 mt-3 flex-wrap">
        {editing ? (
          <>
            <button
              onClick={() => save()}
              disabled={busy}
              className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              บันทึกร่าง
            </button>
            <button
              onClick={() => { setEditing(false); setTitle(article.title); setBody(article.body); }}
              className="text-[12px] font-bold px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-600"
            >
              ยกเลิก
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            แก้ไข
          </button>
        )}
        <button
          onClick={() => save('published')}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} เผยแพร่
        </button>
        <button
          onClick={archive}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          <Archive size={13} /> เก็บถาวร
        </button>
      </div>
    </div>
  );
}

function PendingCard({
  q,
  departments,
  onChanged,
}: {
  q: KnowledgeQuestion;
  departments: KnowledgeDepartment[];
  onChanged: () => void;
}) {
  const [deptId, setDeptId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setErr(null);
    try {
      if (!q.departmentId) {
        if (!deptId) { setErr('เลือกแผนกก่อน'); setBusy(false); return; }
        await routeQuestion(q.id, deptId);
      }
      await retryDistill(q.id);
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-[11px] text-slate-400 mb-1.5">{fmtDateTime(q.answeredAt ?? q.askedAt)}</div>
      <div className="text-[13.5px] text-slate-800 mb-1.5">{q.questionText}</div>
      {q.humanAnswer && (
        <div className="text-[12.5px] bg-green-50 border border-green-100 rounded-lg px-3 py-2 mb-2 text-green-900">
          {q.humanAnswer}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {!q.departmentId && (
          <select
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            className="text-[12.5px] border border-slate-300 rounded-lg px-2 py-1.5"
          >
            <option value="">— เลือกแผนก —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.code} · {d.nameTh}</option>
            ))}
          </select>
        )}
        <button
          onClick={retry}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} ลองสรุปใหม่
        </button>
      </div>
      {err && (
        <div className="flex items-center gap-1 text-rose-600 text-xs mt-2">
          <AlertTriangle size={13} /> {err}
        </div>
      )}
    </div>
  );
}
