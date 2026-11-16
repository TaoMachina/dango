import { useState } from 'react';
import { Code2, MessageCircle, Power, RefreshCw, Settings } from 'lucide-react';
import { SidebarToggle } from '../components/MenuToggle.tsx';
import { Popover, usePopover } from '../components/Popover.tsx';
import { MenuItem, Spinner } from '../components/ui.tsx';
import { rescan, selectModule, shutdown, toggleList } from '../lib/actions.ts';
import { closeEvents } from '../lib/events.ts';
import { useMedia, WIDE_LIST } from '../lib/media.ts';
import { useStore, type Module } from '../lib/store.ts';

const MODULES: { id: Module; label: string; Icon: typeof MessageCircle }[] = [
  { id: 'chat', label: 'Chat', Icon: MessageCircle },
  { id: 'code', label: 'Code', Icon: Code2 },
];

function SettingsMenu() {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<number | null>(null);
  return (
    <div className="p-1.5">
      <MenuItem
        icon={scanning ? <Spinner size={16} /> : <RefreshCw size={16} className="text-muted" />}
        onClick={() => {
          setScanning(true);
          void rescan()
            .then((agents) => setFound(agents.length))
            .finally(() => setScanning(false));
        }}
      >
        Rescan agents
      </MenuItem>
      {found !== null && <p className="px-2.5 pb-1 text-[13px] text-muted">{found === 1 ? '1 agent found' : `${found} agents found`}</p>}
      <p className="px-2.5 py-2 text-[13px] text-muted">Theme follows your system.</p>
      <div className="my-1 border-t border-line" />
      <MenuItem
        icon={<Power size={16} className="text-muted" />}
        onClick={() => {
          closeEvents();
          void shutdown();
        }}
      >
        Quit Dango
      </MenuItem>
    </div>
  );
}

export function Rail() {
  const module = useStore((s) => s.ui.module);
  const collapsed = useStore((s) => s.ui.listCollapsed);
  const wide = useMedia(WIDE_LIST);
  const settings = usePopover();
  // On narrow screens the rail only shows inside the open drawer, so the list is always expanded there.
  const expanded = wide ? !collapsed : true;
  return (
    <nav aria-label="Modules" className="flex h-full w-[60px] shrink-0 flex-col items-center gap-1 pb-3">
      <div className="mb-1 flex h-14 shrink-0 items-center">
        <SidebarToggle expanded={expanded} onClick={() => toggleList(wide)} />
      </div>
      {MODULES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={module === id ? 'page' : undefined}
          onClick={() => selectModule(id)}
          className={`flex w-12 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] transition-colors ${module === id ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
        >
          <Icon size={20} strokeWidth={1.8} />
          {label}
        </button>
      ))}
      <div className="flex-1" />
      <button
        ref={settings.anchor}
        type="button"
        aria-label="Settings"
        title="Settings"
        aria-expanded={settings.open !== null}
        onClick={() => settings.setOpen(settings.open ? null : 'open')}
        className="flex size-10 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-fg"
      >
        <Settings size={20} strokeWidth={1.8} />
      </button>
      {settings.open && (
        <Popover anchor={settings.anchor} onClose={settings.close} label="Settings" width={240}>
          <SettingsMenu />
        </Popover>
      )}
    </nav>
  );
}
