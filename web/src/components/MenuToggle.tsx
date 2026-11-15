import { Menu, PanelLeft } from 'lucide-react';
import { toggleList } from '../lib/actions.ts';
import { useMedia, WIDE_LIST } from '../lib/media.ts';
import { useStore } from '../lib/store.ts';
import { IconButton } from './ui.tsx';

/** Opens the list drawer on narrow screens; collapses the list column on wide ones. */
export function MenuToggle() {
  const wide = useMedia(WIDE_LIST);
  const collapsed = useStore((s) => s.ui.listCollapsed);
  return (
    <IconButton label={wide ? (collapsed ? 'Show list' : 'Hide list') : 'Open list'} onClick={() => toggleList(wide)}>
      {wide ? <PanelLeft size={18} /> : <Menu size={18} />}
    </IconButton>
  );
}
