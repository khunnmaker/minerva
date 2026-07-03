import { useState } from 'react';
import { LayoutDashboard, ClipboardCheck, ArrowLeftRight, FileCheck2, ListChecks, Wallet, LogOut } from 'lucide-react';
import { useCeres } from './lib/bootstrapContext';
import { clearSession } from './lib/api';
import MdBoard from './MdBoard';
import MdApproval from './MdApproval';
import MdMoney from './MdMoney';
import MdClose from './MdClose';
import MdExpenses from './MdExpenses';

type Tab = 'board' | 'approval' | 'money' | 'close' | 'expenses';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'board', label: 'กระดาน', icon: <LayoutDashboard size={20} /> },
  { key: 'approval', label: 'รอตรวจ', icon: <ClipboardCheck size={20} /> },
  { key: 'money', label: 'เบิก/คืน', icon: <ArrowLeftRight size={20} /> },
  { key: 'close', label: 'ปิดยอด', icon: <FileCheck2 size={20} /> },
  { key: 'expenses', label: 'รายการ', icon: <ListChecks size={20} /> },
];

export default function MdApp() {
  const { agent, bootstrap, onLogout } = useCeres();
  const [tab, setTab] = useState<Tab>('board');

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-800 pb-20 md:pb-0">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-700">
            <Wallet size={22} />
            <span className="font-bold text-lg">Ceres</span>
            <span className="text-slate-400 text-sm hidden sm:inline">
              · {bootstrap.role === 'ceo' ? 'CEO' : 'MD'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500 hidden sm:inline">{agent.name}</span>
            <button
              onClick={() => {
                clearSession();
                onLogout();
              }}
              className="flex items-center gap-1 text-slate-500 hover:text-rose-600"
            >
              <LogOut size={15} /> ออก
            </button>
          </div>
        </div>
        {/* top tab bar on md+ */}
        <div className="hidden md:flex max-w-5xl mx-auto px-4 gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${
                tab === t.key ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        {tab === 'board' && <MdBoard />}
        {tab === 'approval' && <MdApproval />}
        {tab === 'money' && <MdMoney />}
        {tab === 'close' && <MdClose />}
        {tab === 'expenses' && <MdExpenses />}
      </main>

      {/* bottom fixed tab bar on mobile */}
      <nav className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 md:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] ${
                tab === t.key ? 'text-amber-700' : 'text-slate-400'
              }`}
            >
              {t.icon}
              <span className="text-[10px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
