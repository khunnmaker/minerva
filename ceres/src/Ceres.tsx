import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { ApiError, getBootstrap, logout as logoutSuite, type Agent, type Bootstrap } from './lib/api';
import { CeresContext } from './lib/bootstrapContext';
import StaffHome from './StaffHome';
import { CeoApp, NeeApp } from './Md';

export default function Ceres({
  agent,
  onLogout,
  portalUrl,
}: {
  agent: Agent;
  onLogout: () => void;
  portalUrl: string;
}) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshBootstrap = useCallback(() => {
    setLoading(true);
    setError('');
    setAccessDenied(false);
    getBootstrap()
      .then(setBootstrap)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) {
          setAccessDenied(true);
          return;
        }
        setError('โหลดข้อมูลไม่สำเร็จ');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center font-sans text-slate-800">
        <Loader2 className="animate-spin text-amber-600" size={28} />
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center gap-3 font-sans text-slate-800 px-4 text-center">
        <div className="flex items-center gap-1 text-rose-600 text-sm">
          <AlertTriangle size={16} /> บัญชีนี้ยังไม่มีสิทธิ์ใช้ Ceres — ติดต่อผู้ดูแล
        </div>
        <a
          className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
          href={portalUrl}
        >
          กลับไปที่ Pantheon
        </a>
      </div>
    );
  }

  if (error || !bootstrap) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center gap-3 font-sans text-slate-800 px-4">
        <div className="flex items-center gap-1 text-rose-600 text-sm">
          <AlertTriangle size={16} /> {error || 'โหลดข้อมูลไม่สำเร็จ'}
        </div>
        <button
          onClick={refreshBootstrap}
          className="flex items-center gap-1 px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
        >
          <RefreshCw size={15} /> ลองใหม่
        </button>
        <button
          onClick={() => {
            void logoutSuite();
            onLogout();
          }}
          className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600"
        >
          ออกจากระบบ
        </button>
      </div>
    );
  }

  return (
    <CeresContext.Provider value={{ agent, bootstrap, onLogout, refreshBootstrap }}>
      {bootstrap.role === 'messenger' && <StaffHome />}
      {bootstrap.role === 'gm' && <NeeApp />}
      {bootstrap.role === 'ceo' && <CeoApp />}
    </CeresContext.Provider>
  );
}
