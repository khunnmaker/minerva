import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2, AlertTriangle, Building2, Wifi, WifiOff } from 'lucide-react';
import {
  createDepartment,
  deleteDepartment,
  getAgents,
  getDepartments,
  updateDepartment,
  type DepartmentInput,
  type KnowledgeDepartment,
  type MaliAgent,
} from './lib/api';

// แผนกและผู้ตอบ — department + answerer-roster admin (supervisor only, mirrors the
// supervisor-gated /api/mali/departments and /api/mali/agents routes). `code` is the identity
// field and comes first in both forms, per the suite's standing form-field-order rule.
export default function Departments() {
  const [departments, setDepartments] = useState<KnowledgeDepartment[]>([]);
  const [agents, setAgents] = useState<MaliAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    setErr(null);
    Promise.all([getDepartments(), getAgents()])
      .then(([d, a]) => { setDepartments(d.departments); setAgents(a.agents); })
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="flex items-center gap-1.5 font-bold text-slate-800 text-[15px]">
          <Building2 size={17} className="text-green-600" /> แผนกและผู้ตอบ
          <span className="text-slate-400 font-normal text-[12.5px]">· {departments.length} แผนก</span>
        </h2>
        <div className="flex-1" />
        <button
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1 text-[12.5px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
        >
          <Plus size={14} /> เพิ่มแผนก
        </button>
      </div>

      {creating && (
        <DepartmentForm
          agents={agents}
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
      ) : departments.length === 0 ? (
        <div className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
          ยังไม่มีแผนก — เพิ่มแผนกแรกด้านบน
        </div>
      ) : (
        <div className="space-y-2.5">
          {departments.map((d) => (
            <DepartmentRow key={d.id} department={d} agents={agents} agentName={agentName} onChanged={load} />
          ))}
        </div>
      )}
    </section>
  );
}

function DepartmentRow({
  department,
  agents,
  agentName,
  onChanged,
}: {
  department: KnowledgeDepartment;
  agents: MaliAgent[];
  agentName: (id: string) => string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`ลบแผนก "${department.nameTh}"? (ลบไม่ได้ถ้ามีบทความหรือคำถามผูกอยู่)`)) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteDepartment(department.id);
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <DepartmentForm
        agents={agents}
        existing={department}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChanged(); }}
      />
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <span className="text-[11px] font-mono font-bold text-green-700 bg-green-50 rounded px-1.5 py-0.5 mr-1.5">{department.code}</span>
          <span className="font-bold text-[14px] text-slate-800">{department.nameTh}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {department.answererAgentIds.length === 0 ? (
          <span className="text-[12px] text-slate-400">ยังไม่มีผู้ตอบ</span>
        ) : (
          department.answererAgentIds.map((id) => {
            const a = agents.find((x) => x.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-slate-50 text-slate-600 border border-slate-200 rounded-full px-2.5 py-1">
                {a?.lineBound ? <Wifi size={11} className="text-green-600" /> : <WifiOff size={11} className="text-slate-300" />}
                {agentName(id)}
              </span>
            );
          })
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setEditing(true)}
          className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          แก้ไข
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} ลบ
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

function DepartmentForm({
  agents,
  existing,
  onCancel,
  onSaved,
}: {
  agents: MaliAgent[];
  existing?: KnowledgeDepartment;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // code (identity field) first — standing form-field-order rule.
  const [code, setCode] = useState(existing?.code ?? '');
  const [nameTh, setNameTh] = useState(existing?.nameTh ?? '');
  const [answererAgentIds, setAnswererAgentIds] = useState<string[]>(existing?.answererAgentIds ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleAnswerer(id: string) {
    setAnswererAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!code.trim() || !nameTh.trim()) {
      setErr('กรอกรหัสและชื่อแผนก');
      return;
    }
    setBusy(true);
    setErr(null);
    const input: DepartmentInput = { code: code.trim(), nameTh: nameTh.trim(), answererAgentIds };
    try {
      if (existing) await updateDepartment(existing.id, input);
      else await createDepartment(input);
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
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>รหัสแผนก</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} placeholder="เช่น FIN, HR, STOCK" />
        </div>
        <div>
          <label className={labelCls}>ชื่อแผนก</label>
          <input value={nameTh} onChange={(e) => setNameTh(e.target.value)} className={inputCls} placeholder="เช่น บัญชี/การเงิน" />
        </div>
      </div>

      <div>
        <label className={labelCls}>ผู้ตอบประจำแผนก</label>
        {agents.length === 0 ? (
          <div className="text-[12px] text-slate-400">ยังไม่มีรายชื่อพนักงาน</div>
        ) : (
          <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={answererAgentIds.includes(a.id)}
                  onChange={() => toggleAnswerer(a.id)}
                />
                {a.lineBound ? <Wifi size={12} className="text-green-600 shrink-0" /> : <WifiOff size={12} className="text-slate-300 shrink-0" />}
                <span className="flex-1">{a.name}</span>
                <span className="text-slate-400">{a.role}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {err && (
        <div className="flex items-center gap-1 text-rose-600 text-xs">
          <AlertTriangle size={13} /> {err}
        </div>
      )}

      <div className="flex gap-2">
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
