// รายงานบัญชี — GL / trial-balance / partner-ledger views with company + period pickers and a
// CSV download per view, for book-of-record companies. Always carries the non-goal notice:
// ภ.พ.30 filing is out of scope for this phase (docs/JUPITER_P2_PLAN.md §7, §10).
import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  ledgerDownloadReportCsv, ledgerReportGl, ledgerReportPartnerLedger, ledgerReportTrialBalance,
  type AcctCompany, type GlRow, type JournalEntryState, type PartnerLedgerRow, type TrialBalanceRow,
} from '../lib/api';
import { formatMoneyDisplay } from './money';
import { PartnerPicker, inputCls, labelCls } from './shared';

type ReportKind = 'gl' | 'trial-balance' | 'partner-ledger';
const KIND_LABEL: Record<ReportKind, string> = {
  gl: 'บัญชีแยกประเภท (GL)',
  'trial-balance': 'งบทดลอง (TB)',
  'partner-ledger': 'บัญชีคู่ค้า',
};
const REPORT_KINDS = Object.keys(KIND_LABEL) as ReportKind[];

export default function LedgerReports({ companies, initialCompany }: { companies: AcctCompany[]; initialCompany?: string }) {
  const [companyCode, setCompanyCode] = useState(
    initialCompany && companies.some((c) => c.code === initialCompany) ? initialCompany : (companies[0]?.code ?? ''),
  );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<ReportKind>('gl');
  const [glState, setGlState] = useState<JournalEntryState>('posted');
  const [partnerId, setPartnerId] = useState<string | null>(null);

  const [glRows, setGlRows] = useState<GlRow[]>([]);
  const [tbRows, setTbRows] = useState<TrialBalanceRow[]>([]);
  const [plRows, setPlRows] = useState<PartnerLedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (initialCompany && companies.some((c) => c.code === initialCompany)) setCompanyCode(initialCompany);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompany]);

  function load() {
    if (!companyCode) return;
    setLoading(true);
    setErr(null);
    const params = { company: companyCode, from: from || undefined, to: to || undefined };
    const req = kind === 'gl'
      ? ledgerReportGl({ ...params, state: glState }).then((r) => setGlRows(r.rows))
      : kind === 'trial-balance'
        ? ledgerReportTrialBalance(params).then((r) => setTbRows(r.rows))
        : ledgerReportPartnerLedger({ ...params, partnerId: partnerId ?? undefined }).then((r) => setPlRows(r.rows));
    req.catch((e) => setErr(String((e as Error)?.message ?? e))).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCode, kind]);

  async function download() {
    if (!companyCode) return;
    setDownloading(true);
    setErr(null);
    try {
      await ledgerDownloadReportCsv(
        kind,
        {
          company: companyCode, from: from || undefined, to: to || undefined,
          state: kind === 'gl' ? glState : undefined,
          partnerId: kind === 'partner-ledger' ? (partnerId ?? undefined) : undefined,
        },
        `jupiter-${kind}-${companyCode}${from ? `-${from}` : ''}${to ? `_${to}` : ''}.csv`,
      );
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setDownloading(false);
    }
  }

  if (!companies.length) {
    return <div className="text-sm text-[#726C86] bg-white border border-[#E9E4F2] rounded-xl px-4 py-6 text-center">ยังไม่มีบริษัทที่ใช้สมุดบัญชีหลัก</div>;
  }

  return (
    <section>
      <div className="mb-3.5 text-[12.5px] text-[#B45309] bg-[#FEF3E2] border border-[#F5E6CC] rounded-xl px-4 py-2.5 font-semibold">
        ยังไม่รวมการยื่น ภ.พ.30 ในระยะนี้
      </div>

      <div className="bg-white border border-[#E9E4F2] rounded-xl p-3.5 mb-3.5 grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end">
        <div>
          <label className={labelCls}>บริษัท</label>
          <select value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} className={inputCls}>
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
          <label className={labelCls}>รายงาน</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)} className={inputCls}>
            {REPORT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex-1 bg-[#6D28D9] text-white rounded-lg px-3.5 py-2 font-bold text-[13px]">ดูรายงาน</button>
          <button
            onClick={() => void download()}
            disabled={downloading}
            title="ดาวน์โหลด CSV"
            className="inline-flex items-center gap-1.5 bg-white border border-[#E9E4F2] text-[#403A54] rounded-lg px-3 py-2 font-bold text-[12.5px] disabled:opacity-50"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
        </div>
      </div>

      {kind === 'gl' && (
        <div className="mb-3 flex gap-2 items-center">
          <label className="text-[11px] font-semibold text-[#726C86]">สถานะ</label>
          <select value={glState} onChange={(e) => setGlState(e.target.value as JournalEntryState)} className={`${inputCls} w-auto`}>
            <option value="posted">ผ่านรายการแล้ว</option>
            <option value="draft">ร่าง</option>
            <option value="void">ยกเลิก</option>
          </select>
        </div>
      )}
      {kind === 'partner-ledger' && (
        <div className="mb-3 max-w-xs">
          <label className={labelCls}>คู่ค้า (ไม่ระบุ = ทั้งหมด)</label>
          <PartnerPicker value={partnerId} onChange={(id) => setPartnerId(id)} />
        </div>
      )}

      {err && <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{err}</div>}

      <div className="bg-white border border-[#E9E4F2] rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#F2EEF9] font-bold text-[13.5px] text-[#1E1A2B]">{KIND_LABEL[kind]}</div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-violet-300 py-10 justify-center"><Loader2 size={18} className="animate-spin" /> กำลังโหลด…</div>
          ) : kind === 'gl' ? (
            <GlTable rows={glRows} />
          ) : kind === 'trial-balance' ? (
            <TbTable rows={tbRows} />
          ) : (
            <PlTable rows={plRows} />
          )}
        </div>
      </div>
    </section>
  );
}

function GlTable({ rows }: { rows: GlRow[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {['วันที่', 'เลขที่', 'สมุดรายวัน', 'รหัสบัญชี', 'ชื่อบัญชี', 'คู่ค้า', 'คำอธิบาย', 'เดบิต', 'เครดิต'].map((h, i) => (
            <th key={h} className={`px-3 py-2 text-[10px] uppercase tracking-wide text-[#726C86] font-bold border-b border-[#F2EEF9] whitespace-nowrap ${i >= 7 ? 'text-right' : 'text-left'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={9} className="px-3.5 py-6 text-center text-[#726C86] text-sm">ไม่มีข้อมูล</td></tr>}
        {rows.map((r) => (
          <tr key={r.lineId}>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] tabular-nums">{r.date}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9]">{r.entryNo ?? '—'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-[#726C86]">{r.journalCode}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] font-bold tabular-nums">{r.accountCode}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-[#726C86]">{r.accountName}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9]">{r.partnerName || '–'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9]">{r.label || '–'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{r.debit !== '0.00' ? formatMoneyDisplay(r.debit) : '–'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{r.credit !== '0.00' ? formatMoneyDisplay(r.credit) : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TbTable({ rows }: { rows: TrialBalanceRow[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {['รหัสบัญชี', 'ชื่อบัญชี', 'ยอดยกมา', 'เดบิตระหว่างงวด', 'เครดิตระหว่างงวด', 'ยอดคงเหลือ', 'จำนวนบรรทัด'].map((h, i) => (
            <th key={h} className={`px-3 py-2 text-[10px] uppercase tracking-wide text-[#726C86] font-bold border-b border-[#F2EEF9] whitespace-nowrap ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={7} className="px-3.5 py-6 text-center text-[#726C86] text-sm">ไม่มีข้อมูล</td></tr>}
        {rows.map((r) => (
          <tr key={r.accountId}>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] font-bold tabular-nums">{r.accountCode}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-[#726C86]">{r.accountName}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{formatMoneyDisplay(r.openingBalance)}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{formatMoneyDisplay(r.periodDebit)}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{formatMoneyDisplay(r.periodCredit)}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums font-bold">{formatMoneyDisplay(r.closingBalance)}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums text-[#726C86]">{r.lineCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlTable({ rows }: { rows: PartnerLedgerRow[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {['คู่ค้า', 'วันที่', 'เลขที่', 'รหัสบัญชี', 'ชื่อบัญชี', 'คำอธิบาย', 'เดบิต', 'เครดิต', 'ยอดคงเหลือ'].map((h, i) => (
            <th key={h} className={`px-3 py-2 text-[10px] uppercase tracking-wide text-[#726C86] font-bold border-b border-[#F2EEF9] whitespace-nowrap ${i >= 6 ? 'text-right' : 'text-left'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={9} className="px-3.5 py-6 text-center text-[#726C86] text-sm">ไม่มีข้อมูล</td></tr>}
        {rows.map((r) => (
          <tr key={r.lineId}>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9]">{r.partnerName || '–'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] tabular-nums">{r.date}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9]">{r.moveName ?? '—'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] font-bold tabular-nums">{r.accountCode}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-[#726C86]">{r.accountName}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9]">{r.lineName || '–'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{r.debit !== '0.00' ? formatMoneyDisplay(r.debit) : '–'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums">{r.credit !== '0.00' ? formatMoneyDisplay(r.credit) : '–'}</td>
            <td className="px-3 py-2 text-[12.5px] border-b border-[#F2EEF9] text-right tabular-nums font-bold">{formatMoneyDisplay(r.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
