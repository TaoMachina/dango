import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bookmark, Bot, ChevronDown, ChevronRight, FileDiff, FilePlus, Folder, GitBranch, Monitor } from 'lucide-react';
import type { Agent, Conversation, Helper, Message, SessionOption, ThreadInfo } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Popover, usePopover } from '../components/Popover.tsx';
import { Switch } from '../components/ui.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { OpenThreadButton, PlanMark, planProgress, SUBAGENT_STATUS, ToolRow, type TimelineContext } from '../code/CodeTimeline.tsx';
import {
  chapters,
  fileChanges,
  latestPlan,
  LIVE_STATE,
  liveSubagents,
  liveTitle,
  relativePath,
  subagentDetail,
  threadSubagents,
  type FileChange,
  type LiveSubagent,
  type PlanPart,
  type Subagent,
} from '../code/workLog.ts';
import { CopyButton } from '../conversation/MessageActions.tsx';
import { current, EffortSlider, effortLabel, isSelect, ModelList, pillClass, shortModel, tokens, type Select } from '../conversation/SessionPickers.tsx';
import { focusMessage, loadAgentOptions, patchAgent, patchConversation, threadInfo } from '../lib/actions.ts';
import { sessionKey, useStore } from '../lib/store.ts';
import { DeleteButton } from './DeleteButton.tsx';

// The Code thread's right panel: one scrolling overview, top to bottom — where the thread works,
// its context window, plan, subagents, outputs and chapters, then the thread itself.
// Sections without data are left out.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line px-2 py-3 first:border-t-0">
      <h3 className="flex h-6 items-center px-2 text-[12px] font-medium text-muted">{title}</h3>
      {children}
    </section>
  );
}

// ---------- Where ----------

function Fact({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2 px-2 text-[13px]">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {action}
    </div>
  );
}

function Where({ info }: { info: ThreadInfo }) {
  return (
    <Section title="Where">
      <Fact icon={<Monitor size={14} />}>{info.environment}</Fact>
      {info.folder && (
        <Fact icon={<Folder size={14} />} action={<CopyButton text={info.folder} label="Copy path" />}>
          <span className="font-mono text-[12px]" title={info.folder}>
            {info.folder}
          </span>
        </Fact>
      )}
      {info.branch && (
        <Fact icon={<GitBranch size={14} />}>
          <span className="font-mono text-[12px]">{info.branch}</span>
        </Fact>
      )}
    </Section>
  );
}

// ---------- Context ----------

function Context({ used, size }: { used: number; size: number }) {
  const ratio = Math.min(used / size, 1);
  // Visual warning thresholds, the same as the composer's context ring: amber once most of the window is used, red when it is nearly full.
  const tone = ratio > 0.95 ? 'bg-danger' : ratio > 0.8 ? 'bg-warn' : 'bg-muted';
  const text = `${tokens(used)} / ${tokens(size)} tokens · ${Math.round(ratio * 100)}%`;
  return (
    <Section title="Context">
      <div className="px-2">
        <div role="meter" aria-label="Context window" aria-valuemin={0} aria-valuemax={size} aria-valuenow={used} aria-valuetext={text} className="mt-1 h-1 overflow-hidden rounded-full bg-field">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${ratio * 100}%` }} />
        </div>
        <p className="mt-1.5 text-[12px] tabular-nums text-muted">{text}</p>
      </div>
    </Section>
  );
}

// ---------- Plan ----------

function Plan({ plan }: { plan: PlanPart }) {
  const { done, total } = planProgress(plan);
  return (
    <Section title={`Plan · ${done} of ${total} done`}>
      <ul className="flex flex-col gap-1 px-2 pt-1 text-[13px] leading-5">
        {plan.entries.map((entry, index) => (
          <li key={index} className={`flex items-start gap-2 ${entry.status === 'completed' ? 'text-muted' : ''}`}>
            <PlanMark status={entry.status} />
            <span className="min-w-0">{entry.content}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- Subagents ----------

function Face({ agent, dot }: { agent: Agent | undefined; dot: string }) {
  return (
    <span className="relative flex size-6 shrink-0" aria-hidden>
      {agent ? (
        <Avatar avatar={agent.avatar} size={24} />
      ) : (
        <span className="flex size-6 items-center justify-center rounded-full border border-line bg-field text-muted">
          <Bot size={13} />
        </span>
      )}
      <span className={`absolute -bottom-px -right-px size-2 rounded-full ring-2 ring-bg ${dot}`} />
    </span>
  );
}

function LiveItem({ part }: { part: LiveSubagent }) {
  const agent = useStore((s) => (part.agentId ? s.agents[part.agentId] : undefined));
  const state = LIVE_STATE[part.state];
  const line = part.activity ?? part.description;
  return (
    <li className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
      <Face agent={agent} dot={state.dot} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[13px] font-medium">{liveTitle(part, agent?.name)}</span>
          {part.model && <span className="shrink-0 text-[12px] text-faint">{part.model}</span>}
        </span>
        {line && <span className="block truncate text-[12px] text-muted">{line}</span>}
      </span>
      <span className="shrink-0 text-[12px] text-muted">{state.label}</span>
      {part.conversationId && <OpenThreadButton conversationId={part.conversationId} />}
    </li>
  );
}

function ToolSubagentItem({ agent, context }: { agent: Subagent; context: TimelineContext }) {
  const [open, setOpen] = useState(false);
  const status = SUBAGENT_STATUS[agent.status];
  const detail = subagentDetail(agent);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover">
        <Face agent={undefined} dot={status.dot} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{agent.name}</span>
          <span className={`block truncate text-[12px] ${agent.status === 'failed' ? 'text-danger' : 'text-muted'}`}>{detail ?? status.label}</span>
        </span>
        {detail && <span className="shrink-0 text-[12px] text-muted">{status.label}</span>}
        <ChevronRight size={13} aria-hidden className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mb-1 ml-5 border-l border-line pl-2">
          {agent.parts.map((part) => (
            <ToolRow key={part.toolCallId} part={part} live={false} context={context} />
          ))}
        </div>
      )}
    </li>
  );
}

/** The model the agent's own subagents use, set through the agent's native setting. */
function SubagentModel({ agent, setting }: { agent: Agent; setting: NonNullable<Agent['subagentModel']> }) {
  return (
    <div className="px-2 pt-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="subagent-model" className="text-[13px]">
          Subagent model
        </label>
        <select
          id="subagent-model"
          value={setting.value ?? ''}
          onChange={(e) => void patchAgent(agent.id, { subagentModel: e.target.value || null })}
          className="h-7 min-w-0 max-w-[60%] rounded-md border border-line bg-bg px-1.5 text-[13px] text-fg focus:border-faint focus:outline-none focus-visible:outline-2"
        >
          <option value="">Agent default</option>
          {setting.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.name}
            </option>
          ))}
        </select>
      </div>
      <p className="pt-1 text-[12px] leading-4 text-muted">Applies to all of {agent.name}’s work. Takes effect after its current run.</p>
    </div>
  );
}

/** The helper's options with the person's choices for this thread applied. */
function chosenOptions(options: SessionOption[], helper: Helper): SessionOption[] {
  return options.map((o) => {
    const choice = helper.options.find((c) => c.optionId === o.id);
    return choice ? ({ ...o, currentValue: choice.value } as SessionOption) : o;
  });
}

/** One helper: who it is, whether the main agent may use it, and the model and effort it works with. */
function HelperRow({ conversationId, helper }: { conversationId: string; helper: Helper }) {
  const agent = useStore((s) => s.agents[helper.agentId]) as Agent | undefined;
  const offered = useStore((s) => s.agentOptions[helper.agentId]?.options);
  const pop = usePopover();
  if (!agent) return null;
  const options = chosenOptions(offered ?? [], helper);
  const model = options.find((o) => isSelect(o, 'model')) as Select | undefined;
  const effort = options.find((o) => isSelect(o, 'thought_level')) as Select | undefined;
  const effortChoice = effort && current(effort);
  const summary = [model && shortModel(current(model)?.name ?? model.currentValue), effortChoice && effortLabel(effortChoice)].filter(Boolean).join(' · ');
  const save = (next: Partial<Helper>) => void patchConversation(conversationId, { helpers: [{ ...helper, ...next }] });
  const set = (optionId: string, value: string | boolean) =>
    save({ options: [...helper.options.filter((c) => c.optionId !== optionId), { optionId, value }] });

  return (
    <li className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
      <Avatar avatar={agent.avatar} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{agent.name}</span>
        {summary && (
          <button
            ref={pop.anchor}
            type="button"
            aria-label={`${agent.name} model and effort: ${summary}`}
            aria-expanded={pop.open !== null}
            onClick={() => pop.setOpen(pop.open ? null : 'open')}
            className={`${pillClass} -ml-2 h-6 max-w-full px-2 text-[12px]`}
          >
            <span className="truncate">{summary}</span>
            <ChevronDown size={12} className="shrink-0 opacity-70" />
          </button>
        )}
      </span>
      <Switch checked={helper.enabled} label={`Let the main agent use ${agent.name}`} onChange={(enabled) => save({ enabled })} />
      {pop.open && (
        <Popover anchor={pop.anchor} onClose={pop.close} label={`${agent.name} model`} width={320} align="end">
          {model && <ModelList model={model} set={set} />}
          {effort && (
            <div className={`px-3 pb-3 pt-2.5 ${model ? 'border-t border-line' : ''}`}>
              <EffortSlider option={effort} onPick={(value) => set(effort.id, value)} />
            </div>
          )}
        </Popover>
      )}
    </li>
  );
}

/** Other coding agents the main agent may hand work to through Agentry, each with its own model and effort. */
function Helpers({ conversation, agent }: { conversation: Conversation; agent: Agent }) {
  const key = conversation.helpers.map((h) => h.agentId).join(',');
  useEffect(() => {
    for (const helper of conversation.helpers) void loadAgentOptions(helper.agentId);
  }, [key]);
  return (
    <div className="pt-2">
      <p className="px-2 text-[13px]">Helpers</p>
      <p className="px-2 pb-1 text-[12px] leading-4 text-muted">{agent.name} can hand parts of the work to these agents.</p>
      <ul>
        {conversation.helpers.map((helper) => (
          <HelperRow key={helper.agentId} conversationId={conversation.id} helper={helper} />
        ))}
      </ul>
    </div>
  );
}

// ---------- Outputs ----------

function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums" aria-label={`${added} added, ${removed} removed`}>
      <span className="text-add">+{added}</span> <span className="text-del">−{removed}</span>
    </span>
  );
}

function FileRow({ change, root }: { change: FileChange; root: string | undefined }) {
  const [open, setOpen] = useState(false);
  const path = relativePath(change.path, root);
  const name = path.split('/').pop();
  const folder = path.split('/').slice(0, -1).join('/');
  const Icon = change.created ? FilePlus : FileDiff;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={change.path}
        className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
      >
        <ChevronRight size={13} aria-hidden className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <Icon size={14} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
          <span className="text-fg/85 group-hover:text-fg">{name}</span>
          {folder && <span className="ml-1.5 text-muted">{folder}</span>}
        </span>
        <DiffStat added={change.added} removed={change.removed} />
      </button>
      {open && (
        <div className="mb-2 ml-2 mt-1 flex flex-col gap-1.5">
          {change.edits.map((edit) => (
            <DiffView key={edit.toolCallId} path={change.path} oldText={edit.oldText} newText={edit.newText} showPath={false} />
          ))}
        </div>
      )}
    </li>
  );
}

function Outputs({ changes, root }: { changes: FileChange[]; root: string | undefined }) {
  const added = changes.reduce((sum, c) => sum + c.added, 0);
  const removed = changes.reduce((sum, c) => sum + c.removed, 0);
  return (
    <Section title="Outputs">
      <div className="flex h-7 items-center justify-between px-2 text-[12px] text-muted">
        <span>
          {changes.length} {changes.length === 1 ? 'file' : 'files'} changed
        </span>
        <DiffStat added={added} removed={removed} />
      </div>
      <ul>
        {changes.map((change) => (
          <FileRow key={change.path} change={change} root={root} />
        ))}
      </ul>
    </Section>
  );
}

// ---------- Chapters ----------

function Chapters({ pinned }: { pinned: Message[] }) {
  return (
    <Section title="Chapters">
      <ul>
        {pinned.map((message) => (
          <li key={message.id}>
            <button type="button" onClick={() => focusMessage(message.id)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover">
              <Bookmark size={13} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{message.chapter}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- Panel ----------

/** Where the thread works: loaded when the panel opens and again when a run starts or ends, since a run can switch the branch. */
function useThreadInfo(conversation: Conversation) {
  const [info, setInfo] = useState<ThreadInfo | null>(null);
  const idle = conversation.activeRuns === 0;
  useEffect(() => {
    let current = true;
    void threadInfo(conversation.id).then((next) => current && setInfo(next));
    return () => {
      current = false;
    };
  }, [conversation.id, idle]);
  return info;
}

export function CodePanel({ conversation }: { conversation: Conversation }) {
  const thread = useStore((s) => s.threads[conversation.id]);
  const agent = useStore((s) => s.agents[conversation.memberIds[0]]) as Agent | undefined;
  const session = useStore((s) => s.sessions[sessionKey(conversation.id, conversation.memberIds[0])]);
  const project = useStore((s) => (conversation.projectId ? s.projects[conversation.projectId] : undefined));
  const info = useThreadInfo(conversation);
  const catalogId = agent?.catalogId ?? null;
  const messages = thread?.messages;
  const plan = useMemo(() => latestPlan(messages ?? []), [messages]);
  const live = useMemo(() => liveSubagents(messages ?? []), [messages]);
  // Agents that report no subagents through ACP still show the ones read from their tool calls.
  const fromTools = useMemo(() => (live.length > 0 ? [] : threadSubagents(messages ?? [], catalogId)), [live, messages, catalogId]);
  const changes = useMemo(() => fileChanges(messages ?? []), [messages]);
  const pinned = useMemo(() => chapters(messages ?? []), [messages]);
  const context: TimelineContext = { catalogId, root: project?.path };
  const usage = session?.usage ?? null;
  const setting = agent?.subagentModel ?? null;
  const helpers = conversation.helpers.length > 0;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        {info && <Where info={info} />}
        {usage && <Context used={usage.used} size={usage.size} />}
        {plan && <Plan plan={plan} />}
        {(live.length > 0 || fromTools.length > 0 || setting || helpers) && (
          <Section title="Subagents">
            {(live.length > 0 || fromTools.length > 0) && (
              <ul>
                {live.map((part) => (
                  <LiveItem key={part.sessionId} part={part} />
                ))}
                {fromTools.map((sub) => (
                  <ToolSubagentItem key={sub.key} agent={sub} context={context} />
                ))}
              </ul>
            )}
            {agent && setting && <SubagentModel agent={agent} setting={setting} />}
            {agent && helpers && <Helpers conversation={conversation} agent={agent} />}
          </Section>
        )}
        {changes.length > 0 && <Outputs changes={changes} root={project?.path} />}
        {pinned.length > 0 && <Chapters pinned={pinned} />}
        {agent && (
          <Section title="Thread">
            <div className="flex items-center gap-2.5 px-2 py-1">
              <Avatar avatar={agent.avatar} size={28} />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{agent.name}</p>
                {agent.runtimeLabel !== agent.name && <p className="truncate text-[12px] text-muted">{agent.runtimeLabel}</p>}
              </div>
            </div>
          </Section>
        )}
      </div>
      <DeleteButton conversation={conversation} label="Delete thread" />
    </div>
  );
}
