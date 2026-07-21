import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Loader2 } from 'lucide-react';
import {
  baht,
  describeFlagError,
  describeVoidError,
  listFlags,
  resolveFlag,
  voidExpense,
  voidStaffRequest,
  type CeresFlag,
} from './lib/api';
import { useCeres } from './lib/bootstrapContext';

// Owner directive (2026-07-21): GM's review surface ("🚩 รายการติดธง" inside the existing
// อนุมัติ tab, below the receipt checks) and CEO's (ภาพรวม, under the escalations) are the
// SAME component — no new top-level tab either way (owner: "no new top-level tabs"). The
// CEO additionally gets the ยกเลิกรายการ action right on each card (composing feature 1).
export default function FlagsReviewSection({ onChanged }: { onChanged?: () => void }) {
  const { bootstrap } = useCeres();
  const isCeo = bootstrap.role === 'ceo';
  const [flags, setFlags] = useState<CeresFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    listFlags('open')
      .then((r) => setFlags(r.flags))
      .catch(() => setError('โหลดรายการติดธงไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onResolve(flag: CeresFlag) {
    const note = window.prompt('ตรวจสอบ/แก้ไขแล้ว — หมายเหตุ (จำเป็น)');
    if (note == null) return;
    const trimmed = note.trim();
    if (!trimmed) { window.alert('ต้องกรอกหมายเหตุ'); return; }
    setBusyId(flag.id);
    try {
      await resolveFlag(flag.id, trimmed);
      setFlags((current) => current.filter((f) => f.id !== flag.id));
      onChanged?.();
    } catch (err) {
      window.alert(describeFlagError(err));
    } finally {
      setBusyId('');
    }
  }

  async function onVoid(flag: CeresFlag) {
    const targetLabel = flag.targetType === 'request' ? 'คำขอ' : 'ค่าใช้จ่าย';
    const reason = window.prompt(`ยกเลิกรายการ${targetLabel}นี้ทั้งหมด — กรอกเหตุผล (จำเป็น)`);
    if (reason == null) return;
    const trimmed = reason.trim();
    if (!trimmed) { window.alert('ต้องกรอกเหตุผล'); return; }
    setBusyId(flag.id);
    try {
      if (flag.targetType === 'request') await voidStaffRequest(flag.targetId, trimmed);
      else await voidExpense(flag.targetId, trimmed);
      setFlags((current) => current.filter((f) => f.id !== flag.id));
      onChanged?.();
    } catch (err) {
      const described = describeVoidError(err);
      const extra = described.blockers?.length
        ? `\nต้องจัดการ ${described.blockers.length} รายการก่อน: ${described.blockers.map((b) => `${b.category ?? ''} ${baht(Number(b.amount))}`).join(', ')}`
        : described.remainingOutstanding
          ? `\nยอดค้าง: ${baht(Number(described.remainingOutstanding))}`
          : '';
      window.alert(described.message + extra);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div>
      <div className="text-sm font-semibold text-slate-500 mb-2">🚩 รายการติดธง</div>
      {error ? (
        <div className="flex items-center gap-1 text-rose-600 text-xs py-3">
          <AlertTriangle size={13} /> {error}
        </div>
      ) : loading ? (
        <div className="py-6 flex justify-center text-slate-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : flags.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-6 bg-white rounded-xl border border-slate-200">ไม่มีรายการติดธง</div>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => {
            const busy = busyId === f.id;
            return (
              <div key={f.id} className="bg-white rounded-xl border border-amber-200 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">
                    {f.targetType === 'request' ? 'คำขอ' : 'ค่าใช้จ่าย'} · {f.subject?.payee || f.subject?.partyName || f.targetId}
                  </span>
                  {f.subject && <span className="font-bold shrink-0">{baht(Number(f.subject.amount))}</span>}
                </div>
                {f.subject?.category && <div className="text-xs text-slate-400">{f.subject.category}</div>}
                <div className="text-xs text-slate-500 mt-1 break-words">
                  <span className="font-medium">{f.flaggedByName}:</span> {f.note}
                </div>
                <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                  {isCeo && (
                    <button
                      onClick={() => onVoid(f)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} ยกเลิกรายการ
                    </button>
                  )}
                  <button
                    onClick={() => onResolve(f)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} ตรวจสอบแล้ว
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
