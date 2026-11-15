import { useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar.tsx';
import { CopyBox } from '../components/CopyBox.tsx';
import { Button, inputClass, Label } from '../components/ui.tsx';
import { createExternalAgent, patchAgent } from '../lib/actions.ts';
import { useStore } from '../lib/store.ts';

export function AddAgentForm() {
  const agents = useStore((s) => s.agents);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState<string | null>(null);
  const hidden = useMemo(() => Object.values(agents).filter((a) => a.hidden), [agents]);

  return (
    <div className="p-4">
      {instruction ? (
        <>
          <p className="mb-2 text-[14px]">Paste this into your agent. It will join and say hello.</p>
          <CopyBox text={instruction} />
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void createExternalAgent(name.trim())
              .then((result) => setInstruction(result.instruction))
              .finally(() => setBusy(false));
          }}
        >
          <Label htmlFor="agent-name">Name (optional — the agent introduces itself)</Label>
          <div className="flex gap-2">
            <input id="agent-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Hermes" />
            <Button type="submit" variant="primary" disabled={busy}>
              Get instruction
            </Button>
          </div>
        </form>
      )}
      {hidden.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-1 text-[13px] text-muted">Hidden agents</p>
          <ul>
            {hidden.map((agent) => (
              <li key={agent.id} className="flex items-center gap-2.5 py-1.5">
                <Avatar avatar={agent.avatar} size={28} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{agent.name}</span>
                <Button className="h-7 px-3 text-[13px]" onClick={() => void patchAgent(agent.id, { hidden: false })}>
                  Show
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
