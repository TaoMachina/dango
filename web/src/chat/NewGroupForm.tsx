import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { ID } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Button, inputClass, Label } from '../components/ui.tsx';
import { createConversation, select } from '../lib/actions.ts';
import { useStore } from '../lib/store.ts';

export function NewGroupForm({ onDone }: { onDone: () => void }) {
  const agents = useStore((s) => s.agents);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<ID[]>([]);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => Object.values(agents).filter((a) => !a.hidden).sort((a, b) => a.name.localeCompare(b.name)), [agents]);

  const toggle = (id: ID) => setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);

  return (
    <form
      className="p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void createConversation({ kind: 'group', title: title.trim(), memberIds: picked, leadId: picked[0] })
          .then((group) => {
            onDone();
            select('chat', group.id);
          })
          .finally(() => setBusy(false));
      }}
    >
      <Label htmlFor="group-name">Name</Label>
      <input id="group-name" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch crew" />
      <p className="mb-1 mt-4 text-[13px] text-muted">Members</p>
      <ul className="grid grid-cols-4 gap-1">
        {list.map((agent) => {
          const index = picked.indexOf(agent.id);
          return (
            <li key={agent.id}>
              <button
                type="button"
                aria-pressed={index >= 0}
                onClick={() => toggle(agent.id)}
                className={`relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[12px] ${index >= 0 ? 'bg-selected' : 'hover:bg-hover'}`}
              >
                <span className="relative">
                  <Avatar avatar={agent.avatar} size={40} />
                  {index >= 0 && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-accent-fg ring-2 ring-bg">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center">{agent.name}</span>
                {index === 0 && <span className="text-[11px] text-muted">Lead</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button type="submit" variant="primary" disabled={busy || !title.trim() || picked.length === 0}>
          Create group
        </Button>
      </div>
    </form>
  );
}
