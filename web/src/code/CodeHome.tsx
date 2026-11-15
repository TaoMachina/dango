import { MenuToggle } from '../components/MenuToggle.tsx';
import { useMedia, WIDE_LIST } from '../lib/media.ts';
import { useStore } from '../lib/store.ts';

/** Code with nothing selected. */
export function CodeHome() {
  const hasProjects = useStore((s) => Object.keys(s.projects).length > 0);
  const collapsed = useStore((s) => s.ui.listCollapsed);
  const wide = useMedia(WIDE_LIST);
  return (
    <div className="flex h-full flex-col">
      {(!wide || collapsed) && (
        <div className="flex h-14 items-center px-3">
          <MenuToggle />
        </div>
      )}
      <div className="flex flex-1 items-center justify-center p-6 text-[15px] text-muted">
        {hasProjects ? 'Pick a thread or start a new one.' : 'Add a project folder to start.'}
      </div>
    </div>
  );
}
