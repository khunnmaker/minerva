// Small shared atoms for the Phase-2 ledger UI (JournalEntries / JournalEntryForm / EntryDetail /
// LedgerReports) — badges + the two searchable pickers, kept out of Accounting.tsx per the plan
// ("prefer new components rather than further enlarging the existing file").
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ledgerPartners, type JournalEntryState, type LedgerAccount, type LedgerPartner } from '../lib/api';

export const inputCls = 'border border-[#E9E4F2] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#F3EEFE] w-full';
export const labelCls = 'text-[11px] font-semibold text-[#726C86] mb-1 block';

export function StateBadge({ state }: { state: JournalEntryState }) {
  const map: Record<JournalEntryState, { label: string; cls: string }> = {
    draft: { label: 'ร่าง', cls: 'bg-[#FEF3E2] text-[#B45309]' },
    posted: { label: 'ผ่านรายการแล้ว', cls: 'bg-[#E9F7EF] text-[#0F9D58]' },
    void: { label: 'ยกเลิก', cls: 'bg-[#F1F0F5] text-[#726C86]' },
  };
  const s = map[state];
  return <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

export function SourceBadge({ source }: { source: string }) {
  if (source !== 'sync:odoo') return null;
  return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded whitespace-nowrap bg-[#EEF2FF] text-[#4338CA]">นำเข้าจาก Odoo</span>;
}

// "สมุดบัญชีหลัก" — shown beside a company chip once its ledgerMode is book_of_record.
export function BorBadge() {
  return <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded whitespace-nowrap bg-[#6D28D9] text-white">สมุดบัญชีหลัก</span>;
}

// ── Account picker: search matches code + name, but the field always DISPLAYS the code. ──
export function AccountPicker({
  accounts, value, onChange, placeholder = 'เลือกบัญชี',
}: {
  accounts: LedgerAccount[];
  value: string; // accountId, '' = none chosen
  onChange: (accountId: string, account: LedgerAccount | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = accounts.find((a) => a.id === value) ?? null;
  const q = query.trim().toLowerCase();
  const matches = (q
    ? accounts.filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    : accounts
  ).slice(0, 30);

  return (
    <div className="relative" ref={boxRef}>
      <input
        value={open ? query : (selected ? selected.code : '')}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        placeholder={placeholder}
        className={inputCls}
      />
      {selected && !open && <div className="text-[10.5px] text-[#726C86] mt-0.5 truncate">{selected.name}</div>}
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-[#E9E4F2] rounded-lg shadow-lg">
          {matches.length === 0 && <div className="px-3 py-2 text-[12px] text-[#726C86]">ไม่พบบัญชี</div>}
          {matches.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onChange(a.id, a); setQuery(''); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[#F3EEFE] flex gap-2"
            >
              <span className="font-bold text-[#1E1A2B] tabular-nums shrink-0">{a.code}</span>
              <span className="text-[#726C86] truncate">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Partner picker: free-text search against the global partner table (debounced). ──
export function PartnerPicker({
  value, onChange, placeholder = 'ไม่ระบุคู่ค้า',
}: {
  value: string | null;
  onChange: (partnerId: string | null, partner: LedgerPartner | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<LedgerPartner[]>([]);
  const [selected, setSelected] = useState<LedgerPartner | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Resolve a partnerId that arrives from outside (e.g. loading an existing draft) into a
  // display name, without re-resolving once we already hold the matching selection.
  useEffect(() => {
    if (!value) { setSelected(null); return; }
    if (selected?.id === value) return;
    ledgerPartners({ limit: 100 }).then((rows) => {
      const found = rows.find((p) => p.id === value);
      if (found) setSelected(found);
    }).catch(() => { /* best-effort label resolution */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      ledgerPartners({ search: query.trim() || undefined, limit: 20 }).then(setOptions).catch(() => {});
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex gap-1.5">
        <input
          value={open ? query : (selected?.displayName ?? '')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(''); setOpen(true); }}
          placeholder={placeholder}
          className={inputCls}
        />
        {selected && !open && (
          <button type="button" onClick={() => { setSelected(null); onChange(null, null); }} className="text-[#726C86] hover:text-rose-600 px-1" title="ล้างคู่ค้า">
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-[#E9E4F2] rounded-lg shadow-lg">
          <button
            type="button"
            onClick={() => { setSelected(null); onChange(null, null); setQuery(''); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-[#726C86] hover:bg-[#F3EEFE]"
          >
            — ไม่ระบุคู่ค้า —
          </button>
          {options.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setSelected(p); onChange(p.id, p); setQuery(''); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[#F3EEFE] truncate"
            >
              {p.displayName}
            </button>
          ))}
          {options.length === 0 && <div className="px-3 py-1.5 text-[12px] text-[#726C86]">พิมพ์เพื่อค้นหา…</div>}
        </div>
      )}
    </div>
  );
}
