import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ID } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { MenuToggle } from '../components/MenuToggle.tsx';
import { Popover, usePopover } from '../components/Popover.tsx';
import { MenuItem } from '../components/ui.tsx';
import { ComposerBox } from '../conversation/ComposerBox.tsx';
import { createConversation, select, sendMessage } from '../lib/actions.ts';
import { useMedia, WIDE_LIST } from '../lib/media.ts';
import { useStore } from '../lib/store.ts';

/** A new code thread starts from one prompt to one agent in the project folder. */
export function NewThread({ projectId }: { projectId: ID }) {
  const project = useStore((s) => s.projects[projectId]);
  const agents = useStore((s) => s.agents);
  const wide = useMedia(WIDE_LIST);
  const choices = useMemo(
    () => Object.values(agents).filter((a) => a.source === 'acp').sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name)),
    [agents],
  );
  const [agentId, setAgentId] = useState<ID | null>(choices[0]?.id ?? null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const picker = usePopover();
  const agent = agentId ? agents[agentId] : undefined;

  const submit = () => {
    setBusy(true);
    const prompt = text.trim();
    void createConversation({ kind: 'code', projectId, agentId: agentId! })
      .then(async (conversation) => {
        select('code', conversation.id);
        await sendMessage(conversation.id, prompt, []);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex h-full flex-col">
      {!wide && (
        <div className="flex h-14 items-center px-3">
          <MenuToggle />
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
        <h2 className="mb-6 text-center text-[22px] font-semibold">What should we build in {project?.name}?</h2>
        <div className="w-full max-w-2xl">
          <ComposerBox value={text} onChange={setText} onSubmit={submit} placeholder="Describe the task" autoFocus busy={busy || !agent} />
          <div className="mt-1.5 flex items-center px-[7px]">
            <button
              ref={picker.anchor}
              type="button"
              aria-label={`Agent: ${agent?.name ?? 'none'}`}
              aria-expanded={picker.open !== null}
              onClick={() => picker.setOpen(picker.open ? null : 'open')}
              className="inline-flex h-7 items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg"
            >
              {agent ? (
                <>
                  <Avatar avatar={agent.avatar} size={20} />
                  {agent.name}
                </>
              ) : (
                'No agents can code here'
              )}
              <ChevronDown size={12} className="opacity-70" />
            </button>
            {picker.open && (
              <Popover anchor={picker.anchor} onClose={picker.close} label="Agent" width={260}>
                <div className="p-1.5">
                  {choices.map((choice) => (
                    <MenuItem
                      key={choice.id}
                      active={choice.id === agentId}
                      icon={<Avatar avatar={choice.avatar} size={22} />}
                      onClick={() => {
                        setAgentId(choice.id);
                        picker.close();
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex-1 truncate">{choice.name}</span>
                        {choice.id === agentId && <Check size={14} />}
                      </span>
                    </MenuItem>
                  ))}
                </div>
              </Popover>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
