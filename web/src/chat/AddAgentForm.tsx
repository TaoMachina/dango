import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar.tsx';
import { CopyBox } from '../components/CopyBox.tsx';
import { Button } from '../components/ui.tsx';
import { inviteAgent, patchAgent } from '../lib/actions.ts';
import { useStore } from '../lib/store.ts';

// Opening the form makes an invitation right away: copy, paste into the agent, and it joins under its own name.
export function AddAgentForm() {
  const agents = useStore((s) => s.agents);
  const [instruction, setInstruction] = useState<string | null>(null);
  const hidden = useMemo(() => Object.values(agents).filter((a) => a.hidden), [agents]);

  useEffect(() => {
    void inviteAgent().then((result) => setInstruction(result.instruction));
  }, []);

  return (
    <div className="p-4">
      <p className="mb-2 text-[14px]">Paste this into your agent. It joins with its own name and says hello.</p>
      {instruction ? <CopyBox text={instruction} /> : <div className="h-[120px] rounded-xl bg-field" aria-busy="true" />}
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
