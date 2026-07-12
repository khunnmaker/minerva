import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Login from './Login';
import Portal from './Portal';
import { bootstrap, getStoredAgent, getToken, setOnUnauthorized, type Agent } from './lib/api';

export default function App() {
  const [agent, setAgent] = useState<Agent | null>(() => getToken() ? getStoredAgent() : null);
  const [booting, setBooting] = useState(() => !getToken());

  useEffect(() => {
    setOnUnauthorized(() => setAgent(null));
    return () => setOnUnauthorized(null);
  }, []);

  useEffect(() => {
    if (!booting) return;
    let alive = true;
    bootstrap()
      .then((a) => { if (alive && a) setAgent(a); })
      .finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, [booting]);

  if (booting) {
    return <div className="min-h-screen bg-gradient-to-b from-violet-50 to-slate-100 flex items-center justify-center text-violet-300"><Loader2 size={22} className="animate-spin" /></div>;
  }
  if (!agent) return <Login onLogin={setAgent} />;
  return <Portal agent={agent} onLogout={() => setAgent(null)} />;
}
