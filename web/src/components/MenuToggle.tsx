import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { toggleList } from '../lib/actions.ts';
import { useMedia, WIDE_LIST } from '../lib/media.ts';

const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B';

/**
 * The sidebar toggle. It sits 12px from the left edge, vertically centred in a 56px row,
 * both at the top of the rail and in narrow-screen headers, so the pointer never moves.
 */
export function SidebarToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${shortcut})`}
      onClick={onClick}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      {expanded ? <PanelLeftClose size={18} strokeWidth={1.8} /> : <PanelLeft size={18} strokeWidth={1.8} />}
    </button>
  );
}

/** Narrow screens only: opens the sidebar drawer from a header. Wide screens use the rail toggle. */
export function MenuToggle() {
  const wide = useMedia(WIDE_LIST);
  if (wide) return null;
  return <SidebarToggle expanded={false} onClick={() => toggleList(false)} />;
}
