// สมุดรายวัน — journal-entry list with company/period/state/journal filters. Draft rows carry
// the ร่าง badge, Odoo-imported rows carry นำเข้าจาก Odoo (both via StateBadge/SourceBadge),
// per docs/JUPITER_P2_PLAN.md §7.
import { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Plus } from 'lucide-react';
import { ledgerEntries, type AcctCompany, type JournalEntry, type JournalEntryState } from '../lib/api';
import { formatMoneyDisplay, sumMoney } from './money';
import { StateBadge, SourceBadge, inputCls, labelCls } from './shared';

const STATE_OPTIONS: { value: JournalEntryState | ''; label: string }[] = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'draft', label: 'ร่าง' },
  { value: 'posted', label: 'ผ่านรายการแล้ว' },
  { value: 'void', label: 'ยกเลิก' },
];

const TH_MON_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')} ${TH_MON_SHORT[m - 1]} ${y + 543}`;
}

export default function JournalEntries({
  companies, company, onOpenEntry, onCreateNew,
}: {
  companies: AcctCompany[];
  company: string; // '' = every company
  onOpenEntry: (id: string) => void;
  onCreateNew: () => void;
}) {
  const [companyFilter, setCompanyFilter] = useState(company);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState<JournalEntryState | ''>('');
  const [journal, setJournal] = useState('');
  const [items, setItems] = useState<JournalEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setCompanyFilter(company); }, [company]);

  function load() {
    setLoading(true);
    setErr(null);
    ledgerEntries({
      company: companyFilter || undefined, from: from || undefined, to: to || undefined,
      state: state || undefined, journal: journal.trim() || undefined, limit: 50,
    })
      .then((page) => { setItems(page.items); setNextCursor(page.nextCursor); })
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyFilter]);

  function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    ledgerEntries({
      company: companyFilter || undefined, from: from || undefined, to: to || undefined,
      state: state || undefined, journal: journal.trim() || undefined, limit: 50, cursor: nextCursor,
    })
      .then((page) => { setItems((prev) => [...prev, ...page.items]); setNextCursor(page.nextCursor); })
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoadingMore(false));
  }

  const nameOf = (code: string) => companies.find((c) => c.code === code)?.name ?? code;

  return (
    <section>
      <div className="bg-white border border-[#E9E4F2] rounded-xl p-3.5 mb-3.5 grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end">
        <div>
          <label className={labelCls}>บริษัท</label>
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className={inputCls}>
            <option value="">ทุกบริษัท</option>
            {companies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>จากวันที่</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>ถึงวันที่</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>สถานะ</label>
          <select value={state} onChange={(e) => setState(e.target.value as JournalEntryState | '')} className={inputCls}>
            {STATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelCls}>สมุดรายวัน (รหัส)</label>
            <input value={journal} onChange={(e) => setJournal(e.target.value)} className={inputCls} placeholder="เช่น GEN" />
          </div>
          <button onClick={load} className="bg-[#6D28D9] text-white rounded-lg px-3.5 font-bold text-[13px] h-[38px] self-end shrink-0">
            ค้นหา
          </button>
        </div>
      </div>

      <div className="mb-3">
        <button onClick={onCreateNew} className="inline-flex items-center gap-1.5 bg-[#6D28D9] text-white rounded-lg px-3.5 py-2 font-bold text-[13px]">
          <Plus size={15} /> สร้างรายการใหม่
        </button>
      </div>

      {err && <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{err}</div>}

      <div className="bg-white border border-[#E9E4F2] rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#F2EEF9] font-bold text-[13.5px] text-[#1E1A2B]">
          สมุดรายวัน <span className="text-[#726C86] font-normal text-[11.5px]">· {items.length} รายการ</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['วันที่', 'เลขที่', 'บริษัท', 'สมุดรายวัน', 'คู่ค้า', 'เลขที่อ้างอิง', 'รวมเดบิต', 'รวมเครดิต', 'สถานะ', ''].map((h, i) => (
                  <th key={h + i} className={`px-3 py-2.5 text-[10px] uppercase tracking-wide text-[#726C86] font-bold border-b border-[#F2EEF9] whitespace-nowrap ${i <= 5 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3.5 py-8 text-center text-violet-300"><Loader2 className="inline animate-spin" size={18} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} className="px-3.5 py-6 text-center text-[#726C86] text-sm">ยังไม่มีรายการ</td></tr>
              ) : items.map((e) => {
                const debitTotal = sumMoney(e.lines.map((l) => l.debit));
                const creditTotal = sumMoney(e.lines.map((l) => l.credit));
                return (
                  <tr key={e.id} onClick={() => onOpenEntry(e.id)} className="cursor-pointer hover:bg-[#F3EEFE]">
                    <td className="px-3 py-2.5 text-[12.5px] border-b border-[#F2EEF9] text-[#726C86] tabular-nums">{thShortDate(e.entryDate)}</td>
                    <td className="px-3 py-2.5 text-[12.5px] border-b border-[#F2EEF9] font-bold text-[#1E1A2B]">{e.entryNo ?? '—'}</td>
                    <td className="px-3 py-2.5 text-[12.5px] border-b border-[#F2EEF9]">
                      <span className="font-bold">{e.companyCode}</span> <span className="text-[#726C86]">{nameOf(e.companyCode)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] border-b border-[#F2EEF9] text-[#726C86]">{e.journal.code}</td>
                    <td className="px-3 py-2.5 text-[12.5px] border-b border-[#F2EEF9]">{e.partner?.displayName ?? '–'}</td>
                    <td className="px-3 py-2.5 text-[12.5px] border-b border-[#F2EEF9] text-[#726C86]">{e.ref || '–'}</td>
                    <td className="px-3 py-2.5 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{formatMoneyDisplay(debitTotal)}</td>
                    <td className="px-3 py-2.5 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{formatMoneyDisplay(creditTotal)}</td>
                    <td className="px-3 py-2.5 border-b border-[#F2EEF9] text-right">
                      <div className="flex justify-end gap-1 flex-wrap">
                        <StateBadge state={e.state} />
                        <SourceBadge source={e.source} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 border-b border-[#F2EEF9] text-right text-[#726C86]"><ChevronRight size={14} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {nextCursor && (
          <div className="p-3 text-center border-t border-[#F2EEF9]">
            <button onClick={loadMore} disabled={loadingMore} className="text-[12.5px] font-bold text-[#6D28D9] disabled:opacity-50">
              {loadingMore ? <Loader2 className="inline animate-spin" size={14} /> : 'โหลดเพิ่ม'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
