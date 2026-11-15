import { useEffect } from 'react';
import { loadState, restoreFromUrl } from '../lib/actions.ts';
import { connectEvents } from '../lib/events.ts';
import { useStore } from '../lib/store.ts';
import { Toasts } from '../components/Toasts.tsx';
import { Shell } from './Shell.tsx';

let started = false;

function start() {
  if (started) return;
  started = true;
  window.addEventListener('popstate', restoreFromUrl);
  void loadState().then(connectEvents);
}

export function App() {
  const auth = useStore((s) => s.auth);
  useEffect(start, []);

  if (auth === 'unauthorized' || auth === 'closed') {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted">
        {auth === 'closed' ? 'Rea is closed. Open it from its desktop icon.' : 'Open Rea from its desktop icon.'}
      </div>
    );
  }
  return (
    <>
      {auth === 'ok' && <Shell />}
      <Toasts />
    </>
  );
}
