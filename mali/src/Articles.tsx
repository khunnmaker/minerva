import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Archive, AlertTriangle, Search, BookOpen, Radio } from 'lucide-react';
import {
  archiveArticle,
  articleStatusLabel,
  audienceLabel,
  createArticle,
  getArticles,
  getDepartments,
  updateArticle,
  type Agent,
  type ArticleInput,
  type Audience,
  type ArticleStatus,
  type KnowledgeArticle,
  type KnowledgeDepartment,
} from './lib/api';

const AUDIENCES: Audience[] = ['everyone', 'gm_plus', 'supervisor'];
const STATUSES: ArticleStatus[] = ['draft', 'published', 'archived'];

// คลังบทความ — the article library. GET /api/mali/articles is open to every role (the server
// scopes results by audience + published-only for non-supervisors), so this page is visible to
// everyone; only supervisors get the create/edit/archive controls, matching the supervisor-only
// write routes in api/src/routes/mali.ts.
export default function Articles({ agent }: { agent: Agent }) {
  const isSupervisor = agent.role === 'supervisor';
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [departments, setDepartments] = useState<KnowledgeDepartment[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    setErr(null);
    getArticles(isSupervisor && showArchived)
      .then((r) => setArticles(r.articles))
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, [isSupervisor, showArchived]);

  useEffect(() => {
    if (!isSupervisor) return;
    getDepartments().then((r) => setDepartments(r.departments)).catch(() => {});
  }, [isSupervisor]);

  const deptName = (id: string) => departments.find((d) => d.id === id)?.nameTh ?? id;
  const filtered = q.trim()
    ? articles.filter((a) => a.title.toLowerCase().includes(q.trim().toLowerCase()) || a.body.toLowerCase().includes(q.trim().toLowerCase()))
    : articles;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="flex items-center gap-1.5 font-bold text-slate-800 text-[15px]">
          <BookOpen size={17} className="text-green-600" /> คลังบทความ
          <span className="text-slate-400 font-normal text-[12.5px]">· {filtered.length} บทความ</span>
        </h2>
        <div className="flex-1" />
        {isSupervisor && (
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1 text-[12.5px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
          >
            <Plus size={14} /> เพิ่มบทความ
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาบทความ…"
            className="w-full text-[13px] border border-slate-300 rounded-lg pl-8 pr-3 py-2"
          />
        </div>
        {isSupervisor && (
          <label className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            แสดงที่เก็บถาวร
          </label>
        )}
      </div>

      {isSupervisor && creating && (
        <ArticleForm
          departments={departments}
          onCancel={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}

      {err && (
        <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          โหลดไม่สำเร็จ: {err}
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-2 text-green-300 py-12 justify-center">
          <Loader2 size={20} className="animate-spin" /> กำลังโหลด…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
          ยังไม่มีบทความ
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((a) => (
            <ArticleRow
              key={a.id}
              article={a}
              isSupervisor={isSupervisor}
              departments={departments}
              deptName={deptName}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ArticleRow({
  article,
  isSupervisor,
  departments,
  deptName,
  onChanged,
}: {
  article: KnowledgeArticle;
  isSupervisor: boolean;
  departments: KnowledgeDepartment[];
  deptName: (id: string) => string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5 text-[11px]">
        <span className="font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{deptName(article.departmentId)}</span>
        <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{audienceLabel(article.audience)}</span>
        <span className={`px-1.5 py-0.5 rounded ${article.status === 'published' ? 'bg-green-50 text-green-700' : article.status === 'draft' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
          {articleStatusLabel(article.status)}
        </span>
        {article.lineExposable && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-50 text-slate-500" title="ตอบได้ทาง LINE">
            <Radio size={10} /> LINE
          </span>
        )}
      </div>

      {editing ? (
        <ArticleForm
          departments={departments}
          existing={article}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged(); }}
        />
      ) : (
        <>
          <div className="font-bold text-[14px] text-slate-800 mb-1">{article.title}</div>
          <div className="text-[13px] text-slate-600 whitespace-pre-wrap line-clamp-4">{article.body}</div>
        </>
      )}

      {isSupervisor && !editing && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setEditing(true)}
            className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            แก้ไข
          </button>
          {article.status !== 'archived' && (
            <ArchiveButton articleId={article.id} onChanged={onChanged} />
          )}
        </div>
      )}
    </div>
  );
}

function ArchiveButton({ articleId, onChanged }: { articleId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    if (!confirm('เก็บถาวรบทความนี้? (จะไม่แสดงในผลลัพธ์อีกต่อไป)')) return;
    setBusy(true);
    setErr(null);
    try {
      await archiveArticle(articleId);
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />} เก็บถาวร
      </button>
      {err && <span className="text-xs text-rose-600 ml-2">{err}</span>}
    </>
  );
}

// Shared create/edit form. Title is the identity field and comes first (standing form-field-
// order rule). audience === 'supervisor' forces lineExposable off, mirroring the server
// (routes/mali.ts createArticle/updateArticle), so the checkbox disables itself in that case
// instead of silently lying about what will be saved.
function ArticleForm({
  departments,
  existing,
  onCancel,
  onSaved,
}: {
  departments: KnowledgeDepartment[];
  existing?: KnowledgeArticle;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? departments[0]?.id ?? '');
  const [audience, setAudience] = useState<Audience>(existing?.audience ?? 'everyone');
  const [lineExposable, setLineExposable] = useState(existing?.lineExposable ?? true);
  const [status, setStatus] = useState<ArticleStatus>(existing?.status ?? 'draft');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim() || !body.trim() || !departmentId) {
      setErr('กรอกชื่อเรื่อง เนื้อหา และเลือกแผนกให้ครบ');
      return;
    }
    setBusy(true);
    setErr(null);
    const input: ArticleInput = {
      title: title.trim(),
      body: body.trim(),
      departmentId,
      audience,
      lineExposable: audience === 'supervisor' ? false : lineExposable,
      status,
    };
    try {
      if (existing) await updateArticle(existing.id, input);
      else await createArticle(input);
      onSaved();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'w-full text-[13px] border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100';
  const labelCls = 'text-[11px] font-semibold text-slate-500 mb-1 block';

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${existing ? '' : 'bg-white border border-slate-200 rounded-xl p-4 mb-3'}`}>
      <div className="sm:col-span-2">
        <label className={labelCls}>ชื่อเรื่อง</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="เช่น วิธีขอใบเสร็จย้อนหลัง" />
      </div>
      <div className="sm:col-span-2">
        <label className={labelCls}>เนื้อหา</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>แผนก</label>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputCls}>
          <option value="">— เลือกแผนก —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.code} · {d.nameTh}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>กลุ่มผู้อ่าน</label>
        <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className={inputCls}>
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>{audienceLabel(a)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>สถานะ</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as ArticleStatus)} className={inputCls}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{articleStatusLabel(s)}</option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <label className={`flex items-center gap-1.5 text-[12.5px] ${audience === 'supervisor' ? 'text-slate-300' : 'text-slate-600'}`}>
          <input
            type="checkbox"
            checked={audience === 'supervisor' ? false : lineExposable}
            disabled={audience === 'supervisor'}
            onChange={(e) => setLineExposable(e.target.checked)}
          />
          ตอบได้ทาง LINE
        </label>
      </div>

      {err && (
        <div className="sm:col-span-2 flex items-center gap-1 text-rose-600 text-xs">
          <AlertTriangle size={13} /> {err}
        </div>
      )}

      <div className="sm:col-span-2 flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12.5px] font-bold px-3.5 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} บันทึก
        </button>
        <button
          onClick={onCancel}
          className="text-[12.5px] font-bold px-3.5 py-2 rounded-lg text-slate-400 hover:text-slate-600"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
