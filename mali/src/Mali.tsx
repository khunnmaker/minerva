import { useMemo } from 'react';
import { LogOut } from 'lucide-react';
import { useHashTab } from '@pantheon/ui';
import AppSwitcher from './AppSwitcher';
import Inbox from './Inbox';
import Review from './Review';
import Articles from './Articles';
import Departments from './Departments';
import { logout, type Agent } from './lib/api';

// Mali's shell: top bar (app switcher + sign-out) + a hash-synced tab strip, mirroring the
// Jupiter/Ceres "one cockpit, several tabs" pattern (see jupiter/src/Accounting.tsx). Mali is an
// all-staff app with THREE admin-only pages (Phase 3 spec: "supervisors see everything;
// department answerers see only their inbox + answering") — ตรวจร่างบทความ and แผนกและผู้ตอบ
// hit supervisor-only endpoints server-side, so their tabs are hidden entirely for anyone else.
// คลังบทความ stays visible to everyone (its GET is open to all roles, scoped by audience server
// -side) but only supervisors get the create/edit/archive controls inside it.
type Tab = 'inbox' | 'review' | 'articles' | 'departments';
const BASE_TABS: Tab[] = ['inbox', 'articles'];
const SUPERVISOR_TABS: Tab[] = ['inbox', 'review', 'articles', 'departments'];

export default function Mali({ agent, onLogout }: { agent: Agent; onLogout: () => void }) {
  const isSupervisor = agent.role === 'supervisor';
  const tabs = useMemo<Tab[]>(() => (isSupervisor ? SUPERVISOR_TABS : BASE_TABS), [isSupervisor]);
  const [tab, setTab] = useHashTab<Tab>(tabs, 'inbox');

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <header className="bg-white border-b border-green-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <AppSwitcher agent={agent} />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 hidden sm:inline">{agent.name}</span>
            <button
              onClick={() => { void logout(); onLogout(); }}
              className="flex items-center gap-1 text-slate-500 hover:text-rose-600"
            >
              <LogOut size={15} /> ออก
            </button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-3 sm:px-4 flex gap-0.5 overflow-x-auto">
          <TabBtn active={tab === 'inbox'} onClick={() => setTab('inbox')}>คำถามรอตอบ</TabBtn>
          {isSupervisor && (
            <TabBtn active={tab === 'review'} onClick={() => setTab('review')}>ตรวจร่างบทความ</TabBtn>
          )}
          <TabBtn active={tab === 'articles'} onClick={() => setTab('articles')}>คลังบทความ</TabBtn>
          {isSupervisor && (
            <TabBtn active={tab === 'departments'} onClick={() => setTab('departments')}>แผนกและผู้ตอบ</TabBtn>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {tab === 'inbox' && <Inbox agent={agent} />}
        {tab === 'review' && isSupervisor && <Review />}
        {tab === 'articles' && <Articles agent={agent} />}
        {tab === 'departments' && isSupervisor && <Departments />}
      </main>

      <footer className="max-w-4xl mx-auto px-4 py-6 text-center text-[11px] text-slate-400">
        มะลิ — คลังความรู้ทีมงาน · ถามครั้งเดียว ตอบได้ทุกครั้งต่อไป
      </footer>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-3 text-[13.5px] font-bold -mb-px border-b-[2.5px] whitespace-nowrap ${
        active ? 'text-green-700 border-green-600' : 'text-slate-500 border-transparent hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
