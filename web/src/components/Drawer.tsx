import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A side drawer for narrow screens. Escape or a click on the backdrop closes it. */
export function Drawer({ side, label, onClose, children }: { side: 'left' | 'right'; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current!.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-40 flex bg-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`flex h-full max-w-[88vw] bg-bg shadow-pop focus:outline-none ${side === 'right' ? 'ml-auto' : ''}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
