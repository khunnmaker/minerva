import { useEffect, useRef, useState } from 'react';
import {
  Loader2, AlertTriangle, CalendarRange, TrendingUp, TrendingDown, PackageSearch, ShieldAlert, RefreshCw, Sparkles,
  ClipboardList, Flag, Square, Footprints, Search, Link2,
} from 'lucide-react';
import {
  getDashboard, recompute, generateCards, getActionItems, getVisits, linkVisit, getCustomers, postActionItemDone,
  segmentColor, formatBaht, formatDate, trendArrow, trendColor, SEGMENTS,
  type DashboardResult, type VenusActionItem, type VenusVisit, type VenusCustomerListRow,
} from './lib/api';

// Management lens (VENUS_BRIEF.md §8): segment distribution, at-risk list ranked by M
// ("lose the biggest first"), top movers, and the opportunity queue (reorder-due
// customers). Pure reads over CustomerStats via GET /api/venus/dashboard — nothing here
// recomputes; that only happens via the supervisor's POST /api/venus/recompute.
export default function Dashboard({ onOpen, canManage }: { onOpen: (code: string) => void; canManage?: boolean }) {
  const [data, setData] = useState<DashboardResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeErr, setRecomputeErr] = useState('');

  // การเข้าพบ (VENUS_VISITS_PLAN.md Phase 2): the suite-wide open follow-up queue and the
  // awaiting_match unmatched-visit queue. Independent loads/failures from the RFM dashboard
  // above — a visits-API hiccup must not blow up the rest of the page.
  const [followUps, setFollowUps] = useState<VenusActionItem[]>([]);
  const [followUpsErr, setFollowUpsErr] = useState('');
  const [unmatched, setUnmatched] = useState<VenusVisit[]>([]);
  const [unmatchedErr, setUnmatchedErr] = useState('');

  function load() {
    setBusy(true);
    setErr('');
    getDashboard()
      .then(setData)
      .catch(() => setErr('โหลดแดชบอร์ดไม่สำเร็จ'))
      .finally(() => setBusy(false));
  }
  function loadFollowUps() {
    setFollowUpsErr('');
    getActionItems({ open: 1 }).then(setFollowUps).catch(() => setFollowUpsErr('โหลดรายการติดตามไม่สำเร็จ'));
  }
  function loadUnmatched() {
    setUnmatchedErr('');
    getVisits({ status: 'awaiting_match' }).then(setUnmatched).catch(() => setUnmatchedErr('โหลดรายการที่ยังไม่จับคู่ไม่สำเร็จ'));
  }
  useEffect(() => { load(); loadFollowUps(); loadUnmatched(); }, []);

  // This view is scoped to open=1, so ticking an item off just drops it from the list
  // (optimistic); a failed API call re-inserts it at the front so nothing silently vanishes.
  function handleActionItemDone(item: VenusActionItem) {
    setFollowUps((prev) => prev.filter((i) => i.id !== item.id));
  }
  function handleActionItemRevert(item: VenusActionItem) {
    setFollowUps((prev) => [item, ...prev]);
  }

  async function handleVisitLinked(visitId: string) {
    setUnmatched((prev) => prev.filter((v) => v.id !== visitId));
    loadFollowUps(); // a newly linked visit's action items may now show a customer
  }

  async function onRecompute() {
    setRecomputing(true);
    setRecomputeErr('');
    try {
      await recompute();
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setRecomputeErr(msg === 'forbidden' ? 'เฉพาะหัวหน้าเท่านั้น' : 'คำนวณใหม่ไม่สำเร็จ');
    } finally {
      setRecomputing(false);
    }
  }

  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  async function onGenerateCards() {
    setGenerating(true);
    setGenMsg('');
    try {
      const r = await generateCards({ full: true });
      setGenMsg(
        r.started
          ? `เริ่มสร้างคำแนะนำ AI ทั้งหมดในเบื้องหลังแล้ว (ลูกค้าที่มีสัญญาณ ${r.candidates ?? '~2,000'} ราย) — ใช้เวลาสักครู่ การ์ดจะทยอยขึ้นบนหน้าลูกค้า`
          : (r.skippedNoLlm ?? 0) > 0
          ? 'ยังไม่ได้ตั้งค่า AI key บนเซิร์ฟเวอร์ (ระบบยังทำงานได้ — จะแสดงเป็นแบดจ์สัญญาณแทน)'
          : (r.skippedError ?? 0) > 0
          ? 'AI ทำงานผิดพลาด (อาจต้องตรวจรุ่นโมเดล/คีย์) — แจ้งผู้ดูแลระบบ'
          : 'ไม่มีลูกค้าที่มีสัญญาณให้สร้างคำแนะนำ',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setGenMsg(msg === 'forbidden' ? 'เฉพาะหัวหน้าเท่านั้น' : 'สร้างคำแนะนำไม่สำเร็จ');
    } finally {
      setGenerating(false);
    }
  }

  if (busy) {
    return (
      <div className="py-16 flex justify-center text-slate-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="flex items-center gap-1 text-rose-600 text-sm py-8 justify-center">
        <AlertTriangle size={14} /> {err || 'ไม่มีข้อมูล'}
      </div>
    );
  }

  const maxSegmentCount = Math.max(1, ...SEGMENTS.map((s) => data.segmentCounts[s] ?? 0));

  return (
    <div className="space-y-4">
      {/* Data-coverage banner — a short window must never be misread as a real trend. */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-2 flex-wrap text-sm text-slate-600">
        <CalendarRange size={16} className="text-rose-500 shrink-0" />
        <span>
          ข้อมูลการขาย: <b>{formatDate(data.coverage.from)}</b> – <b>{formatDate(data.coverage.to)}</b>
        </span>
        <span className="ml-auto text-xs text-slate-400">
          ลูกค้าทั้งหมด {data.totalCustomers.toLocaleString('th-TH')} · มีข้อมูลการซื้อ {data.totalWithSales.toLocaleString('th-TH')} ราย
        </span>
        {canManage && (
          <button
            onClick={onRecompute}
            disabled={recomputing}
            title="คำนวณกลุ่มลูกค้า/สัญญาณใหม่จากข้อมูลล่าสุด (อาจใช้เวลาสักครู่)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-60 shrink-0"
          >
            {recomputing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {recomputing ? 'กำลังคำนวณ…' : 'คำนวณใหม่'}
          </button>
        )}
        {canManage && (
          <button
            onClick={onGenerateCards}
            disabled={generating}
            title="สร้างคำแนะนำ AI สำหรับลูกค้ารายมูลค่าสูงที่มีสัญญาณ (ใช้เวลาสักครู่)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold disabled:opacity-60 shrink-0"
          >
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {generating ? 'กำลังสร้าง…' : 'สร้างคำแนะนำ AI'}
          </button>
        )}
      </div>
      {recomputeErr && (
        <div className="flex items-center gap-1 text-rose-600 text-xs -mt-2 px-1">
          <AlertTriangle size={12} /> {recomputeErr}
        </div>
      )}
      {genMsg && <div className="text-xs -mt-2 px-1 text-slate-600">{genMsg}</div>}

      {/* รายการติดตาม — open action items from visit reports (VENUS_VISITS_PLAN.md Phase 2),
          needsOwner first (server-sorted) with an amber flag marker. */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-500 mb-1 flex items-center gap-1.5">
          <ClipboardList size={15} className="text-rose-500" /> รายการติดตาม
        </h3>
        <p className="text-xs text-slate-400 mb-3">รายการที่ทีมขายบันทึกไว้จากการเข้าพบลูกค้า ยังไม่ปิด</p>
        {followUpsErr ? (
          <div className="flex items-center gap-1 text-rose-600 text-xs py-2"><AlertTriangle size={12} /> {followUpsErr}</div>
        ) : followUps.length === 0 ? (
          <div className="text-sm text-slate-300 py-4 text-center">ไม่มีรายการติดตามค้าง</div>
        ) : (
          <div className="space-y-1">
            {followUps.map((item) => (
              <FollowUpRow key={item.id} item={item} onDone={handleActionItemDone} onRevert={handleActionItemRevert} />
            ))}
          </div>
        )}
      </section>

      {/* ยังไม่จับคู่ลูกค้า — awaiting_match visits; rendered ONLY when at least one exists. */}
      {unmatched.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-500 mb-1 flex items-center gap-1.5">
            <Footprints size={15} className="text-amber-500" /> ยังไม่จับคู่ลูกค้า
          </h3>
          <p className="text-xs text-slate-400 mb-3">รายงานเข้าพบที่ระบบยังจับคู่ลูกค้าไม่ได้ — เลือกลูกค้าที่ถูกต้อง</p>
          {unmatchedErr && (
            <div className="flex items-center gap-1 text-rose-600 text-xs py-2"><AlertTriangle size={12} /> {unmatchedErr}</div>
          )}
          <div className="space-y-2">
            {unmatched.map((visit) => (
              <UnmatchedVisitRow key={visit.id} visit={visit} onLinked={handleVisitLinked} />
            ))}
          </div>
        </section>
      )}

      {/* Segment distribution */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">การแบ่งกลุ่มลูกค้า (RFM)</h3>
        <div className="space-y-2">
          {SEGMENTS.map((s) => {
            const n = data.segmentCounts[s] ?? 0;
            return (
              <div key={s} className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-28 text-center shrink-0 ${segmentColor(s)}`}>{s}</span>
                <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${segmentColor(s).split(' ')[0]}`}
                    style={{ width: `${Math.max(2, (n / maxSegmentCount) * 100)}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-slate-700 w-10 text-right shrink-0">{n}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* At-risk list — the headline actionable list, ranked by revenue at stake. */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-500 mb-1 flex items-center gap-1.5">
          <ShieldAlert size={15} className="text-amber-500" /> เสี่ยงหาย — เรียงตามมูลค่าที่จะเสีย
        </h3>
        <p className="text-xs text-slate-400 mb-3">ลูกค้าที่เคยซื้อมาก/บ่อย แต่หายไปนาน — เริ่มจากรายที่มูลค่าสูงสุด</p>
        {data.atRisk.length === 0 ? (
          <div className="text-sm text-slate-300 py-4 text-center">ไม่มีลูกค้าที่เสี่ยงหายตอนนี้</div>
        ) : (
          <div className="space-y-1.5">
            {data.atRisk.map((r) => (
              <button
                key={r.code}
                onClick={() => onOpen(r.code)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-amber-50 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 truncate">{r.name || r.code}</div>
                  <div className="text-xs text-slate-400 font-mono">{r.code} · ซื้อ {r.f} ครั้ง</div>
                </div>
                <span className="text-sm font-bold text-amber-700 shrink-0">{formatBaht(r.m)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Top movers */}
      <section className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-1.5">
            <TrendingUp size={15} className="text-emerald-500" /> ยอดขายพุ่งขึ้น
          </h3>
          <MoverList rows={data.topMovers.up} onOpen={onOpen} />
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-1.5">
            <TrendingDown size={15} className="text-rose-500" /> ยอดขายลดลง
          </h3>
          <MoverList rows={data.topMovers.down} onOpen={onOpen} />
        </div>
      </section>

      {/* Opportunity queue */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-500 mb-1 flex items-center gap-1.5">
          <PackageSearch size={15} className="text-rose-500" /> คิวโอกาสขาย — ถึงรอบสั่งซื้อ
        </h3>
        <p className="text-xs text-slate-400 mb-3">เรียงตามสินค้าที่เลยรอบมากที่สุด</p>
        {data.opportunityQueue.length === 0 ? (
          <div className="text-sm text-slate-300 py-4 text-center">ไม่มีรายการถึงรอบสั่งซื้อตอนนี้</div>
        ) : (
          <div className="space-y-1.5">
            {data.opportunityQueue.slice(0, 30).map((r) => (
              <button
                key={r.code}
                onClick={() => onOpen(r.code)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-rose-50 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 truncate">{r.name || r.code}</div>
                  <div className="text-xs text-slate-400 font-mono truncate">
                    {r.code} · {r.reorderDue.length} รายการถึงรอบ
                  </div>
                </div>
                <span className="text-xs font-semibold text-rose-600 shrink-0">เลยรอบ {r.mostOverdue} วัน</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FollowUpRow({
  item, onDone, onRevert,
}: {
  item: VenusActionItem;
  onDone: (item: VenusActionItem) => void;
  onRevert: (item: VenusActionItem) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    onDone(item); // optimistic — this view is open=1, so a done item just drops out
    try {
      await postActionItemDone(item.id, true);
    } catch {
      onRevert(item);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="w-full flex items-start gap-2 text-left text-sm px-2 py-2 rounded-xl hover:bg-slate-50 disabled:opacity-60"
    >
      <Square size={15} className="text-slate-300 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          {item.needsOwner && <Flag size={13} className="text-amber-500 shrink-0 mt-0.5" />}
          <span className="text-slate-700">{item.text}</span>
        </div>
        <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
          {item.customerCode ? <span className="font-mono">{item.customerCode}</span> : <span>ยังไม่จับคู่ลูกค้า</span>}
          {item.visit?.repName && <span>· {item.visit.repName}</span>}
          {item.visit?.visitAt && <span>· {formatDate(item.visit.visitAt)}</span>}
        </div>
      </div>
    </button>
  );
}

function UnmatchedVisitRow({ visit, onLinked }: { visit: VenusVisit; onLinked: (visitId: string) => void }) {
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState('');

  async function handlePick(code: string) {
    setLinking(true);
    setErr('');
    try {
      await linkVisit(visit.id, code);
      onLinked(visit.id);
    } catch {
      setErr('จับคู่ไม่สำเร็จ');
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="border border-slate-100 rounded-xl p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="text-sm font-medium text-slate-800">
          {visit.extractJson.customerNameGuess || <span className="text-slate-400">(ไม่ทราบชื่อลูกค้า)</span>}
        </div>
        <span className="text-xs text-slate-400 shrink-0">{formatDate(visit.visitAt)} · {visit.repName}</span>
      </div>
      {visit.summary && <p className="text-xs text-slate-600 mb-2">{visit.summary}</p>}
      <CustomerPicker onPick={handlePick} busy={linking} />
      {err && <div className="flex items-center gap-1 text-rose-600 text-xs mt-1"><AlertTriangle size={11} /> {err}</div>}
    </div>
  );
}

// Small debounced customer picker — same search-as-you-type pattern as CustomerList.tsx,
// scoped down to an inline result list for choosing a match rather than navigating.
function CustomerPicker({ onPick, busy }: { onPick: (code: string) => void; busy: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<VenusCustomerListRow[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      getCustomers({ q, limit: 6 })
        .then((r) => setResults(r.customers))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  return (
    <div>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={busy}
          placeholder="ค้นหาลูกค้าเพื่อจับคู่…"
          className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:opacity-60"
        />
      </div>
      {searching && <div className="text-xs text-slate-300 mt-1">กำลังค้นหา…</div>}
      {results.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {results.map((c) => (
            <button
              key={c.code}
              onClick={() => onPick(c.code)}
              disabled={busy}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded-lg border border-slate-100 hover:border-rose-300 hover:bg-rose-50/40 disabled:opacity-60"
            >
              <Link2 size={12} className="text-rose-400 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-slate-700">{c.name || '(ไม่มีชื่อ)'}</span>
              <span className="text-slate-400 font-mono shrink-0">{c.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MoverList({ rows, onOpen }: { rows: DashboardResult['topMovers']['up']; onOpen: (code: string) => void }) {
  if (rows.length === 0) return <div className="text-sm text-slate-300 py-4 text-center">ไม่มีข้อมูล</div>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <button
          key={r.code}
          onClick={() => onOpen(r.code)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-800 truncate">{r.name || r.code}</div>
            <div className="text-xs text-slate-400 font-mono">{r.code}</div>
          </div>
          <span className={`text-sm font-bold shrink-0 ${trendColor(r.trendDir)}`}>
            {trendArrow(r.trendDir)} {Math.abs(r.trendPct).toFixed(0)}%
          </span>
        </button>
      ))}
    </div>
  );
}
