import { useMemo, useRef, useState } from 'react';
import { RefreshCw, UserPlus } from 'lucide-react';
import { Avatar } from '../components/Avatar.tsx';
import { MenuToggle } from '../components/MenuToggle.tsx';
import { Popover } from '../components/Popover.tsx';
import { Button, Spinner } from '../components/ui.tsx';
import { rescan, select } from '../lib/actions.ts';
import { useMedia, WIDE_LIST } from '../lib/media.ts';
import { useStore } from '../lib/store.ts';
import { AddAgentForm } from './AddAgentForm.tsx';

/** Chat with nothing selected: the agent roster, or a way to add the first agent. */
export function ChatHome() {
  const agents = useStore((s) => s.agents);
  const wide = useMedia(WIDE_LIST);
  const roster = useMemo(() => Object.values(agents).filter((a) => !a.hidden).sort((a, b) => a.name.localeCompare(b.name)), [agents]);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {!wide && (
        <div className="flex h-14 items-center px-3">
          <MenuToggle />
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6">
        {roster.length > 0 ? (
          <>
            <p className="text-[15px] text-muted">Pick an agent to start</p>
            <ul className="flex max-w-xl flex-wrap justify-center gap-2">
              {roster.map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    onClick={() => select('chat', agent.chatId)}
                    className="flex w-24 flex-col items-center gap-2 rounded-2xl px-2 py-3 hover:bg-hover"
                  >
                    <Avatar avatar={agent.avatar} size={56} />
                    <span className="w-full truncate text-center text-[13px]">{agent.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Button ref={addRef} variant="primary" onClick={() => setAdding(!adding)}>
              <UserPlus size={16} /> Add agent
            </Button>
            <Button
              variant="ghost"
              disabled={scanning}
              onClick={() => {
                setScanning(true);
                void rescan().finally(() => setScanning(false));
              }}
            >
              {scanning ? <Spinner /> : <RefreshCw size={14} />} Rescan
            </Button>
            {adding && (
              <Popover anchor={addRef} onClose={() => setAdding(false)} label="Add agent" width={360}>
                <AddAgentForm onDone={() => setAdding(false)} />
              </Popover>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
