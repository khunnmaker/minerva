// Single journal-entry detail — header fields, the line grid, and state-gated actions:
// draft -> แก้ไขร่าง / ตรวจสอบและผ่านรายการ / ยกเลิกร่าง; posted -> กลับรายการ only (never
// edit/delete — see docs/JUPITER_P2_PLAN.md §7).
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ArrowLeft, Ban, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import {
  LedgerApiError, ledgerEntry, ledgerPostEntry, ledgerReverseEntry, ledgerVoidEntry,
  type AcctCompany, type JournalEntry,
} from '../lib/api';
import { formatMoneyDisplay, sumMoney } from './money';
import { StateBadge, SourceBadge, inputCls, labelCls } from './shared';

function thDate(iso: string | null): string {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${String(d).padStart(2, '0')} ${TH[m - 1]} ${y + 543}`;
}

const ERROR_TH: Record<string, string> = {
  unbalanced_entry: 'เดบิตและเครดิตไม่เท่ากัน',
  stale_version: 'รายการนี้ถูกแก้ไขโดยคนอื่นแล้ว กรุณาเปิดรายการนี้ใหม่',
  entry_not_draft: 'ผ่านรายการได้เฉพาะรายการสถานะร่างเท่านั้น',
  entry_not_posted: 'กลับรายการได้เฉพาะรายการที่ผ่านแล้วเท่านั้น',
  entry_already_reversed: 'รายการนี้ถูกกลับรายการไปแล้ว',
  lock_date_violation: 'วันที่ลงบัญชีอยู่ก่อนวันที่ล็อกบัญชีของบริษัทนี้',
  paper_only_company: 'บริษัทนี้เป็นนิติบุคคลที่ไม่ได้ใช้งาน (paper only)',
  reason_required: 'กรุณาระบุเหตุผล',
};
function errText(e: unknown): string {
  if (e instanceof LedgerApiError && e.code) return ERROR_TH[e.code] ?? e.message;
  return String((e as Error)?.message ?? e);
}

export default function EntryDetail({
  entryId, companies, onBack, onEdit,
}: {
  entryId: string;
  companies: AcctCompany[];
  onBack: () => void;
  onEdit: (entry: JournalEntry) => void;
}) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [reversalDate, setReversalDate] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [voidReason, setVoidReason] = useState('');

  function load() {
    setLoading(true);
    setErr(null);
    ledgerEntry(entryId).then(setEntry).catch((e) => setErr(errText(e))).finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const nameOf = (code: string) => companies.find((c) => c.code === code)?.name ?? code;

  async function doPost() {
    if (!entry) return;
    setBusy(true);
    setErr(null);
    try {
      setEntry(await ledgerPostEntry(entry.id, entry.version));
      setConfirmPost(false);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doReverse() {
    if (!entry) return;
    if (!reversalDate.trim() || !reversalReason.trim()) { setErr('กรุณากรอกวันที่และเหตุผลของการกลับรายการ'); return; }
    setBusy(true);
    setErr(null);
    try {
      setEntry(await ledgerReverseEntry(entry.id, { version: entry.version, reversalDate, reason: reversalReason.trim() }));
      setConfirmReverse(false);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doVoid() {
    if (!entry) return;
    setBusy(true);
    setErr(null);
    try {
      setEntry(await ledgerVoidEntry(entry.id, { version: entry.version, reason: voidReason.trim() }));
      setConfirmVoid(false);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-violet-300 py-16 justify-center"><Loader2 size={20} className="animate-spin" /> กำลังโหลด…</div>;
  }
  if (!entry) {
    return (
      <div>
        <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] font-bold text-[#6D28D9] hover:text-[#4C1D95] mb-3"><ArrowLeft size={15} /> กลับไปสมุดรายวัน</button>
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{err ?? 'ไม่พบรายการนี้'}</div>
      </div>
    );
  }

  const debitTotal = sumMoney(entry.lines.map((l) => l.debit));
  const creditTotal = sumMoney(entry.lines.map((l) => l.credit));

  return (
    <section>
      <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] font-bold text-[#6D28D9] hover:text-[#4C1D95] mb-3">
        <ArrowLeft size={15} /> กลับไปสมุดรายวัน
      </button>

      {err && <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{err}</div>}

      <div className="bg-white border border-[#E9E4F2] rounded-xl p-4 mb-3.5">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="font-extrabold text-[16px] text-[#1E1A2B]">{entry.entryNo ?? 'ร่าง (ยังไม่มีเลขที่)'}</span>
          <StateBadge state={entry.state} />
          <SourceBadge source={entry.source} />
          {entry.reversalOfId && (
            <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-[#FDECEC] text-[#DC2626]">
              กลับรายการของ {entry.reversalOf?.entryNo ?? entry.reversalOfId}
            </span>
          )}
          {entry.reversedBy && (
            <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-[#FEF3E2] text-[#B45309]">
              ถูกกลับรายการโดย {entry.reversedBy.entryNo ?? entry.reversedBy.id}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-[12.5px]">
          <Field k="บริษัท" v={`${entry.companyCode} · ${nameOf(entry.companyCode)}`} />
          <Field k="วันที่ลงบัญชี" v={thDate(entry.entryDate)} />
          <Field k="สมุดรายวัน" v={`${entry.journal.code} · ${entry.journal.name}`} />
          <Field k="เลขที่อ้างอิง" v={entry.ref || '–'} />
          <Field k="คู่ค้า" v={entry.partner?.displayName ?? '–'} />
          <Field k="เลขที่เอกสาร" v={entry.documentNo || '–'} />
          <Field k="วันที่เอกสาร" v={thDate(entry.documentDate)} />
          <Field k="เลขที่ใบกำกับภาษี" v={entry.taxInvoiceNo || '–'} />
          <Field k="วันที่ใบกำกับภาษี" v={thDate(entry.taxInvoiceDate)} />
          <Field k="เลขที่หนังสือรับรองหัก ณ ที่จ่าย" v={entry.whtCertificateNo || '–'} />
          <Field k="สร้างโดย" v={entry.createdByName || '–'} />
          {entry.state === 'posted' && <Field k="ผ่านรายการโดย" v={entry.postedByName || '–'} />}
        </div>
        {entry.memo && <div className="mt-2.5 text-[12.5px]"><span className="text-[#726C86]">คำอธิบาย: </span>{entry.memo}</div>}
      </div>

      <div className="bg-white border border-[#E9E4F2] rounded-xl overflow-hidden mb-3.5">
        <div className="px-3.5 py-2.5 border-b border-[#F2EEF9] font-bold text-[13.5px] text-[#1E1A2B]">รายการบัญชี</div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['รหัสบัญชี', 'ชื่อบัญชี', 'คู่ค้า', 'คำอธิบาย', 'เดบิต', 'เครดิต'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 text-[10px] uppercase tracking-wide text-[#726C86] font-bold border-b border-[#F2EEF9] ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] font-bold tabular-nums">{l.account.code}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-[#726C86]">{l.account.name}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9]">{l.partner?.displayName ?? '–'}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9]">{l.label || '–'}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{l.debit !== '0.00' ? formatMoneyDisplay(l.debit) : '–'}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{l.credit !== '0.00' ? formatMoneyDisplay(l.credit) : '–'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="px-3 py-2 text-[12.5px] font-bold text-right border-t border-[#E9E4F2]">รวม</td>
                <td className="px-3 py-2 text-[12.5px] font-bold text-right tabular-nums border-t border-[#E9E4F2]">{formatMoneyDisplay(debitTotal)}</td>
                <td className="px-3 py-2 text-[12.5px] font-bold text-right tabular-nums border-t border-[#E9E4F2]">{formatMoneyDisplay(creditTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {entry.state === 'draft' && (
          <>
            <button onClick={() => onEdit(entry)} className="bg-white border border-[#E9E4F2] text-[#403A54] rounded-lg px-3.5 py-2 font-bold text-[13px]">
              แก้ไขร่าง
            </button>
            <button onClick={() => setConfirmPost(true)} className="inline-flex items-center gap-1.5 bg-[#6D28D9] text-white rounded-lg px-3.5 py-2 font-bold text-[13px]">
              <CheckCircle2 size={15} /> ตรวจสอบและผ่านรายการ
            </button>
            <button onClick={() => setConfirmVoid(true)} className="inline-flex items-center gap-1.5 text-[#DC2626] rounded-lg px-3.5 py-2 font-bold text-[13px]">
              <Ban size={15} /> ยกเลิกร่าง
            </button>
          </>
        )}
        {entry.state === 'posted' && !entry.reversedBy && (
          <button onClick={() => setConfirmReverse(true)} className="inline-flex items-center gap-1.5 bg-white border border-[#E9E4F2] text-[#403A54] rounded-lg px-3.5 py-2 font-bold text-[13px]">
            <RotateCcw size={15} /> กลับรายการ
          </button>
        )}
        {entry.state === 'posted' && (
          <span className="text-[11.5px] text-[#726C86]">รายการที่ผ่านแล้วไม่สามารถแก้ไขหรือลบได้ — แก้ไขได้ด้วยการกลับรายการเท่านั้น</span>
        )}
      </div>

      {confirmPost && (
        <ConfirmModal
          title="ยืนยันผ่านรายการ"
          body="เมื่อผ่านรายการแล้ว รายการนี้จะไม่สามารถแก้ไขได้อีก (แก้ไขได้ด้วยการกลับรายการเท่านั้น) ต้องการผ่านรายการนี้หรือไม่?"
          confirmLabel="ผ่านรายการ"
          busy={busy}
          onConfirm={() => void doPost()}
          onCancel={() => setConfirmPost(false)}
        />
      )}
      {confirmVoid && (
        <ConfirmModal
          title="ยืนยันยกเลิกร่าง"
          body={(
            <>
              <div className="mb-2">ยกเลิกรายการร่างนี้? รายการจะเปลี่ยนเป็นสถานะยกเลิกและไม่สามารถผ่านรายการได้อีก</div>
              <label className={labelCls}>เหตุผล (ไม่บังคับ)</label>
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className={inputCls} />
            </>
          )}
          confirmLabel="ยกเลิกร่าง"
          busy={busy}
          onConfirm={() => void doVoid()}
          onCancel={() => setConfirmVoid(false)}
        />
      )}
      {confirmReverse && (
        <ConfirmModal
          title="กลับรายการ"
          body={(
            <>
              <div className="mb-2">สร้างรายการกลับด้าน (สลับเดบิต/เครดิต) แล้วผ่านรายการทันที รายการเดิมยังคงอยู่ในรายงานตามเดิม</div>
              <label className={labelCls}>วันที่ลงบัญชีของรายการกลับ</label>
              <input type="date" value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} className={`${inputCls} mb-2`} />
              <label className={labelCls}>เหตุผล</label>
              <input value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} className={inputCls} />
            </>
          )}
          confirmLabel="ยืนยันกลับรายการ"
          busy={busy}
          onConfirm={() => void doReverse()}
          onCancel={() => setConfirmReverse(false)}
        />
      )}
    </section>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10.5px] text-[#726C86] font-semibold">{k}</div>
      <div className="font-bold text-[#1E1A2B]">{v}</div>
    </div>
  );
}

function ConfirmModal({
  title, body, confirmLabel, busy, onConfirm, onCancel,
}: {
  title: string; body: ReactNode; confirmLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl p-4 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="font-extrabold text-[15px] text-[#1E1A2B] mb-2">{title}</div>
        <div className="text-[12.5px] text-[#403A54] mb-3">{body}</div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="bg-white border border-[#E9E4F2] text-[#403A54] rounded-lg px-3.5 py-1.5 font-bold text-[12.5px]">ยกเลิก</button>
          <button onClick={onConfirm} disabled={busy} className="bg-[#6D28D9] text-white rounded-lg px-3.5 py-1.5 font-bold text-[12.5px] disabled:opacity-50 inline-flex items-center gap-1.5">
            {busy && <Loader2 size={13} className="animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
