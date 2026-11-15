import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useMedia } from '../lib/media.ts';

const GAP = 6;
const MARGIN = 8;

interface Props {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  width?: number;
  align?: 'start' | 'end';
  children: ReactNode;
}

/**
 * A panel anchored to a control. Closes on Escape or a click outside and returns focus to the anchor.
 * Below Tailwind's sm breakpoint (640px) it becomes a bottom sheet.
 */
export function Popover({ anchor, onClose, label, width = 320, align = 'start', children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sheet = !useMedia('(min-width: 640px)');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (sheet) return;
    const place = () => {
      const a = anchor.current!.getBoundingClientRect();
      const height = ref.current!.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === 'start' ? a.left : a.right - width;
      left = Math.min(Math.max(MARGIN, left), vw - width - MARGIN);
      let top = a.bottom + GAP;
      if (top + height > vh - MARGIN) top = a.top - GAP - height >= MARGIN ? a.top - GAP - height : Math.max(MARGIN, vh - MARGIN - height);
      setPos({ top, left });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(ref.current!);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor, align, width, sheet]);

  useEffect(() => {
    const anchorEl = anchor.current;
    const panel = ref.current!;
    const first = panel.querySelector<HTMLElement>('[autofocus], input, textarea, select, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current!.contains(target) && !anchorEl?.contains(target)) closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      // Return focus unless the action that closed the popover already moved it elsewhere.
      if (document.activeElement === document.body || panel.contains(document.activeElement)) anchorEl?.focus();
    };
  }, [anchor]);

  if (sheet) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-end bg-overlay">
        <div
          ref={ref}
          role="dialog"
          aria-label={label}
          className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-bg pb-[env(safe-area-inset-bottom)] shadow-pop"
        >
          {children}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="fixed z-50 overflow-y-auto rounded-2xl border border-line bg-bg shadow-pop"
      style={{
        width,
        maxHeight: `calc(100dvh - ${2 * MARGIN}px)`,
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // Transparent rather than hidden before placement, so the first field can take focus.
        opacity: pos ? 1 : 0,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Popover open state bound to one anchor element. */
export function usePopover<T extends string = 'open'>() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<T | null>(null);
  return { anchor, open, setOpen, close: () => setOpen(null) };
}
