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
  // The event stream retries until the hub answers, and its 'hello' loads the state again,
  // so a hub that is briefly unreachable at first does not leave the page blank.
  void loadState();
  connectEvents();
}

export function App() {
  const auth = useStore((s) => s.auth);
  useEffect(start, []);

  if (auth === 'unauthorized' || auth === 'closed') {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted">
        {auth === 'closed' ? 'Agentry is closed. Open it from its desktop icon.' : 'Open Agentry from its desktop icon.'}
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
