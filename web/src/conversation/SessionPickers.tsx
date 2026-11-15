import { Check, ChevronDown } from 'lucide-react';
import type { ID, SessionOption } from '../../../shared/types.ts';
import { Popover, usePopover } from '../components/Popover.tsx';
import { Switch } from '../components/ui.tsx';
import { setSessionOption } from '../lib/actions.ts';
import { sessionKey, useStore } from '../lib/store.ts';

// The contract asks for model first, then mode, then the rest in the agent's order.
function rank(option: SessionOption) {
  return option.category === 'model' ? 0 : option.category === 'mode' ? 1 : 2;
}

function isEffort(option: SessionOption) {
  return option.category === 'thought_level' || /effort/i.test(option.id);
}

function choiceName(option: SessionOption | undefined) {
  if (!option || option.type !== 'select') return null;
  return option.choices.find((c) => c.value === option.currentValue)?.name ?? option.currentValue;
}

/** One compact control showing the current model and effort; the popover lists every native option. */
export function SessionPickers({ conversationId, agentId }: { conversationId: ID; agentId: ID }) {
  const session = useStore((s) => s.sessions[sessionKey(conversationId, agentId)]);
  const pop = usePopover();
  if (!session || session.options.length === 0) return null;

  const options = session.options.map((option, index) => ({ option, index })).sort((a, b) => rank(a.option) - rank(b.option) || a.index - b.index);
  const model = session.options.find((o) => o.category === 'model') ?? session.options.find((o) => o.type === 'select');
  const effort = session.options.find(isEffort);
  const summary = [choiceName(model), choiceName(effort)].filter(Boolean).join(' · ') || 'Options';
  const set = (id: string, value: string | boolean) => void setSessionOption(conversationId, agentId, id, value);

  return (
    <div className="flex items-center px-2 pt-1">
      <button
        ref={pop.anchor}
        type="button"
        aria-label={`Agent options: ${summary}`}
        aria-expanded={pop.open !== null}
        onClick={() => pop.setOpen(pop.open ? null : 'open')}
        className="inline-flex h-7 max-w-full items-center gap-1 rounded-full px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={13} className="shrink-0" />
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} onClose={pop.close} label="Agent options" width={300}>
          <div className="flex flex-col gap-1 p-1.5">
            {options.map(({ option }) =>
              option.type === 'boolean' ? (
                <div key={option.id} className="flex items-center gap-3 rounded-lg px-2.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px]">{option.name}</span>
                    {option.description && <span className="block text-[12px] leading-4 text-muted">{option.description}</span>}
                  </span>
                  <Switch checked={option.currentValue} label={option.name} onChange={(value) => set(option.id, value)} />
                </div>
              ) : (
                <section key={option.id} aria-label={option.name}>
                  <p className="px-2.5 pb-0.5 pt-1.5 text-[12px] text-muted">{option.name}</p>
                  <ul role="listbox" aria-label={option.name}>
                    {option.choices.map((choice) => (
                      <li key={choice.value} role="option" aria-selected={choice.value === option.currentValue}>
                        <button
                          type="button"
                          onClick={() => set(option.id, choice.value)}
                          className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-hover"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px]">{choice.name}</span>
                            {choice.description && <span className="block text-[12px] leading-4 text-muted">{choice.description}</span>}
                          </span>
                          {choice.value === option.currentValue && <Check size={15} className="mt-0.5 shrink-0" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
