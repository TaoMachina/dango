import { X } from 'lucide-react';
import { dismissToast, useStore } from '../lib/store.ts';

// Errors stay until dismissed so they can be read at any pace (WCAG 2.2.1).
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl bg-accent py-2 pl-4 pr-2 text-[14px] text-accent-fg shadow-pop">
          <span className="min-w-0 flex-1 break-words py-0.5">{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="rounded-full p-1 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
