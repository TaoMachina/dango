import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  Bot,
  Brain,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  Eye,
  Globe,
  Hammer,
  ListTodo,
  Search,
  ShieldQuestion,
  Square,
  SquarePen,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { Agent, ID, Message, Run, ToolContent } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Spinner } from '../components/ui.tsx';
import { MessageMeta } from '../conversation/MessageActions.tsx';
import { ErrorPart, ImagePart } from '../conversation/parts.tsx';
import { answerPermission, openSideThread } from '../lib/actions.ts';
import { useMedia, WIDE_PANEL } from '../lib/media.ts';
import { updateUI, useStore } from '../lib/store.ts';
import { fullTime } from '../lib/time.ts';
import {
  isActive,
  LIVE_STATE,
  liveTitle,
  messageRows,
  relativePath,
  subagentDetail,
  summarize,
  toolTitle,
  type Entry,
  type LiveSubagent,
  type PermissionPartData,
  type PlanPart,
  type Subagent,
  type ToolPart,
} from './workLog.ts';

// The Code thread timeline: the prompt is a compact block on the
// right, the answer reads as a document, and tool activity is a quiet work log.

export interface TimelineContext {
  catalogId: string | null; // the agent's catalog entry; subagent detection depends on its adapter
  root: string | undefined; // project folder, for relative paths
}

const KIND_ICON: Record<string, typeof Wrench> = {
  read: Eye,
  edit: SquarePen,
  delete: Trash2,
  move: ArrowRightLeft,
  search: Search,
  execute: SquareTerminal,
  think: Brain,
  fetch: Globe,
};

// ---------- Work-log line ----------

interface LineProps {
  icon: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  live?: boolean; // the line is what the agent is doing now
  expanded?: boolean; // undefined: the line does not expand
  onToggle?: () => void;
  failed?: boolean;
  children?: ReactNode;
}

/** One quiet row of the work log: icon, one-line label, trailing marks, and optional detail below. */
export function WorkLine({ icon, label, trailing, live, expanded, onToggle, failed, children }: LineProps) {
  const body = (
    <>
      <span className={`flex size-5 shrink-0 items-center justify-center ${failed ? 'text-danger' : live ? 'text-fg' : 'text-muted'}`}>{icon}</span>
      <span className={`min-w-0 flex-1 truncate ${live ? 'shimmer' : 'text-fg/70 group-hover/line:text-fg'}`}>{label}</span>
      {failed && <X size={13} className="shrink-0 text-danger" aria-label="Failed" />}
      {trailing}
      {expanded !== undefined && (
        <ChevronRight size={13} aria-hidden className={`shrink-0 text-faint transition-transform ${expanded ? 'rotate-90' : ''}`} />
      )}
    </>
  );
  const lineClass = 'group/line flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-[13px] leading-5';
  return (
    <div className="min-w-0" aria-busy={live || undefined}>
      {expanded === undefined ? (
        <div className={lineClass}>{body}</div>
      ) : (
        <button type="button" aria-expanded={expanded} onClick={onToggle} className={lineClass}>
          {body}
        </button>
      )}
      {expanded && children}
    </div>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 ml-7 mt-0.5 flex min-w-0 flex-col gap-2">{children}</div>;
}

function ToolContentView({ content }: { content: ToolContent }) {
  switch (content.type) {
    case 'diff':
      return <DiffView path={content.path} oldText={content.oldText} newText={content.newText} />;
    case 'text':
      return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-fg/75">{content.text}</pre>;
    case 'image':
      return <img src={`data:${content.mimeType};base64,${content.data}`} alt="" className="max-h-64 self-start rounded-lg border border-line" />;
    case 'terminal':
      return <p className="text-[12px] text-muted">Terminal output stays in the agent.</p>;
  }
}

// ---------- Entries ----------

export function ToolRow({ part, live, context }: { part: ToolPart; live: boolean; context: TimelineContext }) {
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[part.kind] ?? Wrench;
  const showLocations = part.locations.length > 0 && !part.content.some((c) => c.type === 'diff');
  const expandable = part.content.length > 0 || showLocations;
  return (
    <WorkLine
      icon={<Icon size={14} />}
      label={toolTitle(part, context.catalogId)}
      live={live}
      failed={part.status === 'failed'}
      expanded={expandable ? open : undefined}
      onToggle={() => setOpen(!open)}
    >
      <Detail>
        {showLocations && <p className="truncate font-mono text-[12px] text-muted">{part.locations.map((l) => relativePath(l, context.root)).join(', ')}</p>}
        {part.content.map((content, index) => (
          <ToolContentView key={index} content={content} />
        ))}
      </Detail>
    </WorkLine>
  );
}

function ThoughtRow({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  // Agents often start a thought with a Markdown heading like "**Checking files**"; the label shows its plain text.
  const preview = text.trim().split('\n')[0].replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
  return (
    <WorkLine icon={<Brain size={14} />} label={live ? 'Thinking' : preview || 'Thought'} live={live} expanded={text.trim() ? open : undefined} onToggle={() => setOpen(!open)}>
      <div className="mb-1.5 ml-7 whitespace-pre-wrap text-[13px] leading-5 text-muted">{text}</div>
    </WorkLine>
  );
}

export const SUBAGENT_STATUS: Record<Subagent['status'], { label: string; dot: string }> = {
  running: { label: 'Running', dot: 'bg-warn' },
  completed: { label: 'Completed', dot: 'bg-success' },
  failed: { label: 'Failed', dot: 'bg-danger' },
  stopped: { label: 'Stopped', dot: 'bg-faint' },
  unreported: { label: 'No result reported', dot: 'bg-faint' },
};

export function SubagentRow({ agent, context, streaming }: { agent: Subagent; context: TimelineContext; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const live = agent.status === 'running';
  return (
    <WorkLine
      icon={<Bot size={14} />}
      label={
        <>
          {agent.name}
          <span className="ml-2 text-muted">{subagentDetail(agent) ?? ''}</span>
        </>
      }
      live={live}
      failed={agent.status === 'failed'}
      trailing={!live && <span className="shrink-0 text-[12px] text-muted">{SUBAGENT_STATUS[agent.status].label}</span>}
      expanded={open}
      onToggle={() => setOpen(!open)}
    >
      <div className="mb-1 ml-5 border-l border-line pl-2">
        {agent.parts.map((part) => (
          <ToolRow key={part.toolCallId} part={part} live={isActive({ kind: 'tool', part }, streaming)} context={context} />
        ))}
      </div>
    </WorkLine>
  );
}

/** The subagent's face: the Dango agent's avatar when another agent acts as it, else a bot mark; a dot shows its state. */
export function LiveSubagentFace({ part, agent, size }: { part: LiveSubagent; agent: Agent | undefined; size: number }) {
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden>
      {agent ? <Avatar avatar={agent.avatar} size={size} /> : <Bot size={Math.round(size * 0.75)} />}
      <span className={`absolute -bottom-px -right-px size-1.5 rounded-full ring-2 ring-bg ${LIVE_STATE[part.state].dot}`} />
    </span>
  );
}

/** "Open" for a subagent that has its own thread in Dango: it opens in the right panel. */
export function OpenThreadButton({ conversationId }: { conversationId: ID }) {
  const wide = useMedia(WIDE_PANEL);
  return (
    <button type="button" onClick={() => openSideThread(conversationId, wide)} className="h-6 shrink-0 rounded-md px-1.5 text-[12px] text-muted hover:bg-hover hover:text-fg">
      Open
    </button>
  );
}

function LiveSubagentRow({ part, live }: { part: LiveSubagent; live: boolean }) {
  const agent = useStore((s) => (part.agentId ? s.agents[part.agentId] : undefined));
  const line = part.activity ?? part.description;
  return (
    <WorkLine
      icon={<LiveSubagentFace part={part} agent={agent} size={14} />}
      label={
        <>
          {liveTitle(part, agent?.name)}
          {line && <span className="ml-2 text-muted">{line}</span>}
        </>
      }
      live={live}
      trailing={
        <>
          {part.model && <span className="max-w-32 shrink-0 truncate text-[12px] text-faint">{part.model}</span>}
          {!live && <span className="shrink-0 text-[12px] text-muted">{LIVE_STATE[part.state].label}</span>}
          {part.conversationId && <OpenThreadButton conversationId={part.conversationId} />}
        </>
      }
    />
  );
}

function EntryRow({ entry, live, streaming, context }: { entry: Entry; live: boolean; streaming: boolean; context: TimelineContext }) {
  switch (entry.kind) {
    case 'tool':
      return <ToolRow part={entry.part} live={live} context={context} />;
    case 'thought':
      return <ThoughtRow text={entry.text} live={live} />;
    case 'subagent':
      return <SubagentRow agent={entry.agent} context={context} streaming={streaming} />;
    case 'live':
      return <LiveSubagentRow part={entry.part} live={live} />;
  }
}

function entryKey(entry: Entry, index: number) {
  if (entry.kind === 'tool') return entry.part.toolCallId;
  if (entry.kind === 'subagent') return `subagent-${entry.agent.key}`;
  if (entry.kind === 'live') return `live-${entry.part.sessionId}`;
  return `thought-${index}`;
}

function entryIcon(entry: Entry) {
  if (entry.kind === 'subagent' || entry.kind === 'live') return Bot;
  if (entry.kind === 'thought') return Brain;
  return KIND_ICON[entry.part.kind] ?? Wrench;
}

function entryLabel(entry: Entry, context: TimelineContext, agents: Record<ID, Agent>) {
  if (entry.kind === 'subagent') return entry.agent.name;
  if (entry.kind === 'live') return liveTitle(entry.part, entry.part.agentId ? agents[entry.part.agentId]?.name : undefined);
  if (entry.kind === 'thought') return 'Thinking';
  return toolTitle(entry.part, context.catalogId);
}

/**
 * Consecutive tool calls and thoughts. One entry shows on its own. Several fold into one line:
 * the summary when done, or what the agent is doing now while it works.
 */
function WorkGroup({ entries, streaming, lastInTurn, context }: { entries: Entry[]; streaming: boolean; lastInTurn: boolean; context: TimelineContext }) {
  const [open, setOpen] = useState(false);
  const agents = useStore((s) => s.agents);
  // A thought is live only while it is the last thing the agent produced.
  const liveAt = (entry: Entry, index: number) => isActive(entry, streaming) || (entry.kind === 'thought' && streaming && lastInTurn && index === entries.length - 1);
  const summary = summarize(entries);
  if (entries.length === 1 || summary === null) {
    return (
      <div className="flex flex-col">
        {entries.map((entry, index) => (
          <EntryRow key={entryKey(entry, index)} entry={entry} live={liveAt(entry, index)} streaming={streaming} context={context} />
        ))}
      </div>
    );
  }
  const liveIndex = entries.findLastIndex((entry, index) => liveAt(entry, index));
  const live = liveIndex >= 0 ? entries[liveIndex] : null;
  const kinds = new Set(entries.filter((e) => e.kind !== 'thought').map((e) => (e.kind === 'tool' ? e.part.kind : 'subagent')));
  const SummaryIcon = live ? entryIcon(live) : kinds.size === 1 ? entryIcon(entries.find((e) => e.kind !== 'thought')!) : Hammer;
  return (
    <WorkLine
      icon={<SummaryIcon size={14} />}
      label={live ? entryLabel(live, context, agents) : summary}
      live={live !== null}
      expanded={open}
      onToggle={() => setOpen(!open)}
    >
      <div className="mb-1 ml-2.5 border-l border-line pl-1.5">
        {entries.map((entry, index) => (
          <EntryRow key={entryKey(entry, index)} entry={entry} live={liveAt(entry, index)} streaming={streaming} context={context} />
        ))}
      </div>
    </WorkLine>
  );
}

// ---------- Plan and permission ----------

export function PlanMark({ status }: { status: PlanPart['entries'][number]['status'] }) {
  const Icon = status === 'completed' ? CircleCheck : status === 'in_progress' ? CircleDot : Circle;
  return <Icon size={13} aria-label={status === 'completed' ? 'Done' : status === 'in_progress' ? 'In progress' : 'To do'} className={`mt-[3px] shrink-0 ${status === 'completed' ? 'text-success' : 'text-muted'}`} />;
}

export function planProgress(part: PlanPart) {
  const done = part.entries.filter((e) => e.status === 'completed').length;
  const current = part.entries.find((e) => e.status === 'in_progress');
  return { done, total: part.entries.length, current };
}

function PlanRow({ part }: { part: PlanPart }) {
  const [open, setOpen] = useState(false);
  const { done, total, current } = planProgress(part);
  return (
    <WorkLine
      icon={<ListTodo size={14} />}
      label={
        <>
          Plan · {done} of {total} done
          {current && <span className="ml-2 text-muted">{current.content}</span>}
        </>
      }
      expanded={open}
      onToggle={() => setOpen(!open)}
    >
      <ul className="mb-1.5 ml-7 flex flex-col gap-0.5 text-[13px] leading-5">
        {part.entries.map((entry, index) => (
          <li key={index} className={`flex items-start gap-2 ${entry.status === 'completed' ? 'text-muted' : 'text-fg/80'}`}>
            <PlanMark status={entry.status} />
            {entry.content}
          </li>
        ))}
      </ul>
    </WorkLine>
  );
}

function PermissionRow({ part }: { part: PermissionPartData }) {
  const [sending, setSending] = useState<string | null>(null);
  const outcome = part.outcome;
  const chosen = outcome && 'optionId' in outcome ? part.options.find((o) => o.optionId === outcome.optionId) : null;
  return (
    <div role="group" aria-label="Permission request" className="my-1 rounded-xl border border-line px-3 py-2.5">
      <div className="flex items-start gap-1.5 text-[13px] leading-5">
        <ShieldQuestion size={14} className={`mt-[3px] shrink-0 ${outcome ? 'text-muted' : 'text-warn'}`} />
        <div className="min-w-0 flex-1">
          <Markdown text={part.title} />
        </div>
      </div>
      {outcome ? (
        <p className="ml-5 mt-1 flex items-center gap-1.5 text-[12px] text-muted">
          <Check size={13} />
          {chosen ? chosen.name : 'Cancelled'}
        </p>
      ) : (
        <div className="ml-5 mt-2 flex flex-wrap gap-1.5" aria-label="Choose an option">
          {part.options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              disabled={sending !== null}
              onClick={() => {
                setSending(option.optionId);
                void answerPermission(part.requestId, option.optionId).catch(() => setSending(null));
              }}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[13px] disabled:opacity-60 ${
                option.kind.startsWith('allow') ? 'border-line bg-field text-fg hover:bg-selected' : 'border-line text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              {option.name}
              {sending === option.optionId && <Spinner size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Turns ----------

function elapsed(since: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** "Working for 1m 5s" under a running turn. */
function WorkingLine({ since, waiting }: { since: string; waiting: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // The label shows whole seconds, so it changes once a second.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p role="status" className="px-1 pt-1 text-[13px] tabular-nums">
      <span className={waiting ? 'text-warn' : 'shimmer'}>{waiting ? 'Waiting for approval' : `Working for ${elapsed(since, now)}`}</span>
    </p>
  );
}

function UserPrompt({ message }: { message: Message }) {
  const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
  return (
    <div className="mt-6 flex justify-end first:mt-2" title={fullTime(message.createdAt)}>
      <div className="min-w-0 max-w-[80%] rounded-2xl bg-bubble px-3.5 py-2 text-[14px] leading-6">
        <Markdown text={text} />
        {message.parts.map((part, index) => part.type === 'image' && <ImagePart key={index} part={part} />)}
      </div>
    </div>
  );
}

interface TurnProps {
  message: Message;
  run: Run | undefined;
  context: TimelineContext;
  prompt: string; // the first line of the prompt that started this turn
  latest: boolean; // the thread's latest agent message
}

function AgentTurn({ message, run, context, prompt, latest }: TurnProps) {
  const streaming = message.status === 'streaming';
  const highlighted = useStore((s) => s.ui.highlight === message.id);
  const rows = messageRows(message, context.catalogId);
  const waiting = streaming && rows.some((r) => r.kind === 'permission' && r.part.outcome === null);
  const hasError = rows.some((r) => r.kind === 'error');
  return (
    <div
      id={`message-${message.id}`}
      className={`group/turn -mx-2 mt-3 flex scroll-mt-4 flex-col gap-0.5 rounded-xl px-2 ${highlighted ? 'flash' : ''}`}
      onAnimationEnd={(e) => {
        if (e.animationName === 'flash') updateUI({ highlight: null });
      }}
    >
      {rows.map((row, index) => {
        switch (row.kind) {
          case 'text':
            return (
              <div key={index} className="my-1.5 px-1 text-[15px] leading-7">
                <Markdown text={row.text} />
              </div>
            );
          case 'work':
            return <WorkGroup key={index} entries={row.entries} streaming={streaming} lastInTurn={index === rows.length - 1} context={context} />;
          case 'plan':
            return <PlanRow key={index} part={row.part} />;
          case 'permission':
            return <PermissionRow key={index} part={row.part} />;
          case 'image':
            return <ImagePart key={index} part={row.part} />;
          case 'error':
            return <ErrorPart key={index} text={row.text} />;
        }
      })}
      {streaming && <WorkingLine since={run?.startedAt ?? message.createdAt} waiting={waiting} />}
      {message.status === 'stopped' && <WorkLine icon={<Square size={12} />} label="Stopped" />}
      {message.status === 'error' && !hasError && run?.error && <ErrorPart text={run.error} />}
      {!streaming && <MessageMeta message={message} chapterPrompt={prompt} forkFrom={latest ? message.conversationId : undefined} />}
    </div>
  );
}

function firstLine(message: Message | undefined) {
  const text = message?.parts.find((p) => p.type === 'text');
  return text && text.type === 'text' ? text.text.trim().split('\n')[0].trim() : '';
}

export function CodeTimeline({ messages, runs, context }: { messages: Message[]; runs: Record<string, Run>; context: TimelineContext }) {
  const latestAgent = messages.findLast((m) => m.author.type === 'agent');
  // A Code thread's turns follow the person's prompts, so the prompt that started a turn is the last one before it.
  let prompt: Message | undefined;
  return (
    <>
      {messages.map((message) => {
        if (message.author.type === 'user') prompt = message;
        if (message.author.type === 'user') return <UserPrompt key={message.id} message={message} />;
        if (message.author.type === 'system') {
          const text = message.parts.map((p) => ('text' in p ? p.text : '')).join(' ');
          return (
            <div key={message.id} className="my-3 text-center text-[13px] text-muted">
              <Markdown text={text} />
            </div>
          );
        }
        return (
          <AgentTurn
            key={message.id}
            message={message}
            run={message.runId ? runs[message.runId] : undefined}
            context={context}
            prompt={firstLine(prompt)}
            latest={message === latestAgent}
          />
        );
      })}
    </>
  );
}
