import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Shield } from 'lucide-react';
import type { ID, SessionOption } from '../../../shared/types.ts';
import { Popover, usePopover } from '../components/Popover.tsx';
import { Switch } from '../components/ui.tsx';
import { setSessionOption } from '../lib/actions.ts';
import { sessionKey, useStore } from '../lib/store.ts';

type Select = Extract<SessionOption, { type: 'select' }>;
type SetOption = (id: string, value: string | boolean) => void;

const pillClass =
  'inline-flex h-7 min-w-0 items-center gap-1 rounded-full px-2.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg';

function current(option: Select) {
  return option.choices.find((c) => c.value === option.currentValue);
}

/** "Claude Opus 4.7 (1M context)" -> "Opus 4.7": drop the vendor prefix and any qualifier. */
function shortModel(name: string) {
  return name
    .replace(/\s*\([^)]*\)/g, '')
    .split(/\s[—–-]\s|:\s/)[0]
    .replace(/^Claude\s+/i, '')
    .trim();
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isSelect(option: SessionOption | undefined, category: string): option is Select {
  return option?.type === 'select' && option.category === category;
}

/** The toolbar under the composer: model and effort, access mode, and the context window. */
export function SessionControls({ conversationId, agentId }: { conversationId: ID; agentId: ID }) {
  const session = useStore((s) => s.sessions[sessionKey(conversationId, agentId)]);
  if (!session || (session.options.length === 0 && !session.usage)) return null;

  const { options, usage } = session;
  const model = options.find((o) => isSelect(o, 'model')) as Select | undefined;
  const effort = options.find((o) => isSelect(o, 'thought_level')) as Select | undefined;
  const mode = options.find((o) => isSelect(o, 'mode')) as Select | undefined;
  const more = options.filter((o) => o !== model && o !== effort && o !== mode);
  const set: SetOption = (id, value) => void setSessionOption(conversationId, agentId, id, value);

  return (
    // 7px matches the composer's border and padding, so the pills line up with the text and the ring with the send button.
    <div className="mt-1.5 flex items-center gap-0.5 px-[7px]">
      {(model || effort || more.length > 0) && <ModelPicker model={model} effort={effort} more={more} set={set} />}
      {mode && <ModePicker mode={mode} set={set} />}
      <div className="flex-1" />
      {usage && <ContextRing used={usage.used} size={usage.size} />}
    </div>
  );
}

function ModelPicker({ model, effort, more, set }: { model?: Select; effort?: Select; more: SessionOption[]; set: SetOption }) {
  const pop = usePopover();
  const modelName = model && shortModel(current(model)?.name ?? model.currentValue);
  const effortName = effort && capitalize(current(effort)?.name ?? effort.currentValue);
  const summary = [modelName, effortName].filter(Boolean).join(' · ') || 'Options';

  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        aria-label={`Model and effort: ${summary}`}
        aria-expanded={pop.open !== null}
        onClick={() => pop.setOpen(pop.open ? null : 'open')}
        className={pillClass}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} onClose={pop.close} label="Model" width={320}>
          {model && (
            <div role="radiogroup" aria-label={model.name} className="p-1.5">
              {model.choices.map((choice) => (
                <ChoiceRow key={choice.value} option={model} choice={choice} onPick={() => set(model.id, choice.value)} />
              ))}
            </div>
          )}
          {effort && (
            <div className={`px-3 pb-3 pt-2 ${model ? 'border-t border-line' : ''}`}>
              <p className="pb-1.5 text-[12px] text-muted">{effort.name}</p>
              <Segmented option={effort} onPick={(value) => set(effort.id, value)} />
            </div>
          )}
          {more.length > 0 && <More options={more} set={set} />}
        </Popover>
      )}
    </>
  );
}

function ChoiceRow(props: { option: Select; choice: Select['choices'][number]; onPick: () => void; compact?: boolean; wrap?: boolean }) {
  const { option, choice, onPick, compact, wrap } = props;
  const selected = choice.value === option.currentValue;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 text-left hover:bg-hover ${compact ? 'py-1' : 'py-1.5'}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${compact ? 'text-[13px]' : 'text-[14px]'}`}>{choice.name}</span>
        {choice.description && !compact && <span className={`block text-[12px] leading-4 text-muted ${wrap ? '' : 'truncate'}`}>{choice.description}</span>}
      </span>
      <Check size={15} className={`shrink-0 ${selected ? '' : 'invisible'}`} />
    </button>
  );
}

function Segmented({ option, onPick }: { option: Select; onPick: (value: string) => void }) {
  return (
    // Wraps instead of truncating: Codex offers six effort levels, more than one row holds at popover width.
    <div role="radiogroup" aria-label={option.name} className="flex flex-wrap gap-y-0.5 rounded-lg bg-field p-0.5">
      {option.choices.map((choice) => {
        const selected = choice.value === option.currentValue;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={choice.description ?? undefined}
            onClick={() => onPick(choice.value)}
            className={`h-7 flex-1 whitespace-nowrap rounded-md px-2 text-[13px] transition-colors ${selected ? 'bg-bg text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:bg-code' : 'text-muted hover:text-fg'}`}
          >
            {capitalize(choice.name)}
          </button>
        );
      })}
    </div>
  );
}

/** Options other than model, effort and mode, folded away at the bottom of the model popover. */
function More({ options, set }: { options: SessionOption[]; set: SetOption }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line p-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full items-center gap-1 rounded-lg px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg"
      >
        More
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open &&
        options.map((option) =>
          option.type === 'boolean' ? (
            <div key={option.id} className="flex items-center gap-3 px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{option.name}</span>
                {option.description && <span className="block truncate text-[12px] leading-4 text-muted">{option.description}</span>}
              </span>
              <Switch checked={option.currentValue} label={option.name} onChange={(value) => set(option.id, value)} />
            </div>
          ) : (
            <div key={option.id} role="radiogroup" aria-label={option.name} className="pt-1">
              <p className="px-2.5 pb-0.5 text-[12px] text-muted">{option.name}</p>
              {option.choices.map((choice) => (
                <ChoiceRow key={choice.value} option={option} choice={choice} compact onPick={() => set(option.id, choice.value)} />
              ))}
            </div>
          ),
        )}
    </div>
  );
}

function ModePicker({ mode, set }: { mode: Select; set: SetOption }) {
  const pop = usePopover();
  const name = current(mode)?.name ?? mode.currentValue;
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        aria-label={`${mode.name}: ${name}`}
        aria-expanded={pop.open !== null}
        onClick={() => pop.setOpen(pop.open ? null : 'open')}
        className={pillClass}
      >
        <Shield size={13} className="shrink-0" />
        <span className="truncate">{name}</span>
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} onClose={pop.close} label={mode.name} width={280}>
          <div role="radiogroup" aria-label={mode.name} className="p-1.5">
            {mode.choices.map((choice) => (
              <ChoiceRow
                key={choice.value}
                option={mode}
                choice={choice}
                wrap
                onPick={() => {
                  set(mode.id, choice.value);
                  pop.close();
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function tokens(n: number) {
  const short = (x: number) => String(Math.round(x * 10) / 10);
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${short(n / 1000)}k`;
  return `${short(n / 1_000_000)}M`;
}

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ContextRing({ used, size }: { used: number; size: number }) {
  const ratio = Math.min(used / size, 1);
  // Visual warning thresholds, not limits: amber once most of the window is used, red when it is nearly full.
  const tone = ratio > 0.95 ? 'var(--danger)' : ratio > 0.8 ? 'var(--warn)' : 'var(--muted)';
  const text = `Context ${tokens(used)} / ${tokens(size)} tokens · ${Math.round(ratio * 100)}%`;
  return (
    <span tabIndex={0} role="img" aria-label={text} className="group relative inline-flex size-[18px] shrink-0 rounded-full">
      <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true" className="-rotate-90">
        <circle cx={9} cy={9} r={RADIUS} fill="none" stroke="var(--faint)" strokeOpacity={0.45} strokeWidth={2} />
        <circle
          cx={9}
          cy={9}
          r={RADIUS}
          fill="none"
          stroke={tone}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
        />
      </svg>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden whitespace-nowrap rounded-md bg-accent px-2 py-1 text-[12px] text-accent-fg group-hover:block group-focus:block"
      >
        {text}
      </span>
    </span>
  );
}
