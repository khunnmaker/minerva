import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { createFlag, describeFlagError, type FlagTargetType } from './lib/api';

// Owner directive (2026-07-21): "each person should be able to flag any transaction for
// review." One small reusable button — staff's own cards, GM/CEO's request+expense views,
// RequestDetail — all use this same component so the note prompt and error handling never
// drift between screens. Server enforces visibility (see api/src/ceres/flags.ts); this
// button never hides itself based on ownership, it just relies on the caller only mounting
// it for rows the current user can already see (which every render site already does).
export default function FlagButton({
  targetType,
  targetId,
  onFlagged,
  className = '',
  label = 'ติดธง',
}: {
  targetType: FlagTargetType;
  targetId: string;
  onFlagged?: () => void;
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function flag(e: React.MouseEvent) {
    e.stopPropagation();
    const note = window.prompt('เหตุผลที่ติดธงรายการนี้ (จำเป็น) — จะแจ้งให้ผู้ตรวจสอบเห็น');
    if (note == null) return;
    const trimmed = note.trim();
    if (!trimmed) { window.alert('ต้องกรอกเหตุผล'); return; }
    setBusy(true);
    try {
      await createFlag(targetType, targetId, trimmed);
      onFlagged?.();
    } catch (err) {
      window.alert(describeFlagError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={flag}
      disabled={busy}
      title="ติดธงเพื่อให้ตรวจสอบ"
      className={`inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 disabled:opacity-50 ${className}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Flag size={13} />} {label}
    </button>
  );
}

// Rows with an open flag show this badge everywhere they render (owner spec: "with count
// if >1"). Renders nothing when count is 0/undefined so call sites can pass a possibly-
// missing lookup value without an extra guard.
export function FlagBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span
      title={`ติดธง ${count} รายการ`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-semibold shrink-0"
    >
      🚩{count > 1 ? ` ${count}` : ''}
    </span>
  );
}
