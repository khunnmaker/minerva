import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, UserPlus, Users, X } from 'lucide-react';
import TaskCard from './TaskCard';
import type { Agent, CalendarTask, Person } from './types';
import { getCalendar } from './lib/api';
import { agentAvatar, dateKey, daysInMonth, monthGrid, type CalendarCell } from './lib/ui';

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const CHIP = 'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs';
const CHIP_ON = 'border-transparent bg-blue-50 text-blue-700 ring-1 ring-blue-300';
const CHIP_OFF = 'border-slate-200 text-slate-600 hover:border-blue-300';

export default function CalendarView({ agents, me, isManager, onOpen }: {
  agents: Person[]; me: Agent; isManager: boolean; onOpen: (id: string) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [scope, setScope] = useState(isManager ? 'all' : me.id);
  const [tasks, setTasks] = useState<CalendarTask[] | null>(null);
  const [dayModal, setDayModal] = useState<string | null>(null);
  const todayKey = new Date().toLocaleDateString('en-CA');

  useEffect(() => {
    let cancelled = false;
    setTasks(null);
    const from = dateKey(year, month, 1);
    const to = dateKey(year, month, daysInMonth(year, month));
    void getCalendar(from, to, scope).then((res) => { if (!cancelled) setTasks(res.tasks); });
    return () => { cancelled = true; };
  }, [year, month, scope]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const t of tasks ?? []) { const key = t.dueDate.slice(0, 10); const list = map.get(key); if (list) list.push(t); else map.set(key, [t]); }
    return map;
  }, [tasks]);

  function go(delta: number) { const d = new Date(year, month + delta, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); }
  function goToday() { const t = new Date(); setYear(t.getFullYear()); setMonth(t.getMonth()); }

  const monthTitle = new Date(year, month, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  const cells = monthGrid(year, month);
  const sortedDayKeys = [...tasksByDay.keys()].sort();

  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold">{monthTitle}</h1>
        {!isManager && <p className="text-xs text-slate-500">ปฏิทินของฉัน</p>}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => go(-1)} aria-label="เดือนก่อนหน้า" className="btn rounded-lg border border-slate-200 bg-white"><ChevronLeft size={16}/></button>
        <button onClick={goToday} className="btn rounded-lg border border-slate-200 bg-white">วันนี้</button>
        <button onClick={() => go(1)} aria-label="เดือนถัดไป" className="btn rounded-lg border border-slate-200 bg-white"><ChevronRight size={16}/></button>
      </div>
    </div>

    {isManager && <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
      <button onClick={() => setScope('all')} className={`${CHIP} ${scope === 'all' ? CHIP_ON : CHIP_OFF}`}><Users size={13}/>ทุกคน</button>
      {agents.map((a) => <button key={a.id} onClick={() => setScope(a.id)} className={`${CHIP} ${scope === a.id ? CHIP_ON : CHIP_OFF}`}>
        <img src={agentAvatar(a, agents)} alt="" className="h-[18px] w-[18px] rounded-full"/>{a.name.split(' ')[0]}
      </button>)}
      <button onClick={() => setScope('none')} className={`${CHIP} ${scope === 'none' ? CHIP_ON : CHIP_OFF}`}><UserPlus size={13}/>ยังไม่มอบหมาย</button>
    </div>}

    {tasks === null ? <div className="py-20 text-center text-slate-400">กำลังโหลด…</div> : <>
      <div className="hidden md:grid grid-cols-7 pb-1 text-center text-xs font-semibold text-slate-500">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="hidden md:grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200">
        {cells.map((cell) => {
          const key = dateKey(cell.year, cell.month, cell.day);
          return <DayCell key={key} cell={cell} isToday={key === todayKey} isPast={key < todayKey}
            tasks={tasksByDay.get(key) ?? []} scope={scope} agents={agents} onOpen={onOpen} onMore={() => setDayModal(key)}/>;
        })}
      </div>

      <div className="space-y-4 md:hidden">
        {!sortedDayKeys.length
          ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center"><CalendarDays size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm text-slate-400">ไม่มีงานในเดือนนี้</p></div>
          : sortedDayKeys.map((key) => {
            const isToday = key === todayKey; const isPast = key < todayKey;
            return <div key={key}>
              <h3 className={`mb-1.5 text-xs font-semibold ${isToday ? 'text-blue-700' : isPast ? 'text-slate-400' : 'text-slate-700'}`}>
                {new Date(`${key}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })}{isToday ? ' · วันนี้' : ''}
              </h3>
              <div className="space-y-2">{(tasksByDay.get(key) ?? []).map((t) => <TaskCard key={t.id} task={t} agents={agents} showProject onClick={() => onOpen(t.id)}/>)}</div>
            </div>;
          })}
      </div>
    </>}

    {dayModal && <Shell onClose={() => setDayModal(null)}>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-bold">{new Date(`${dayModal}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        <button aria-label="ปิด" onClick={() => setDayModal(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X/></button>
      </div>
      <div className="max-h-[calc(85vh-70px)] space-y-2 overflow-y-auto p-5">
        {(tasksByDay.get(dayModal) ?? []).map((t) => <TaskCard key={t.id} task={t} agents={agents} showProject onClick={() => { onOpen(t.id); setDayModal(null); }}/>)}
      </div>
    </Shell>}
  </div>;
}

function DayCell({ cell, isToday, isPast, tasks, scope, agents, onOpen, onMore }: {
  cell: CalendarCell; isToday: boolean; isPast: boolean; tasks: CalendarTask[]; scope: string; agents: Person[];
  onOpen: (id: string) => void; onMore: () => void;
}) {
  const shown = tasks.slice(0, 3);
  const extra = tasks.length - shown.length;
  return <div className={`flex min-h-[96px] flex-col p-1.5 ${cell.inMonth ? 'bg-white' : 'bg-slate-50/60'}`}>
    <span className={`self-end text-xs ${!cell.inMonth ? 'text-slate-300' : isToday ? 'grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white' : isPast ? 'text-slate-400' : ''}`}>{cell.day}</span>
    <div className="mt-1 flex min-h-0 flex-1 flex-col gap-1">
      {shown.map((t) => <TaskChip key={t.id} task={t} scope={scope} agents={agents} isPast={isPast} isToday={isToday} onOpen={onOpen}/>)}
      {extra > 0 && <button onClick={onMore} className="text-left text-[11px] text-blue-600">+{extra} งาน</button>}
    </div>
  </div>;
}

function TaskChip({ task, scope, agents, isPast, isToday, onOpen }: {
  task: CalendarTask; scope: string; agents: Person[]; isPast: boolean; isToday: boolean; onOpen: (id: string) => void;
}) {
  const state = isPast ? 'bg-rose-50 text-rose-700' : isToday ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-700';
  return <button onClick={() => onOpen(task.id)} style={{ borderColor: task.project.color }}
    className={`flex w-full items-center gap-1 truncate rounded-md border-l-2 px-1.5 py-0.5 text-left text-[11px] hover:bg-blue-50 ${state}`}>
    {scope === 'all' && task.assignee && <img src={agentAvatar(task.assignee, agents)} alt="" className="h-3 w-3 shrink-0 rounded-full"/>}
    <span className="truncate">{task.title}</span>
    {task.recurrenceRule && <RefreshCw size={10} className="ml-auto shrink-0 opacity-70"/>}
  </button>;
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">{children}</div>
  </div>;
}
