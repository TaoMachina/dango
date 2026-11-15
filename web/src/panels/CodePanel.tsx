import { useMemo, useState, type KeyboardEvent } from 'react';
import { Bot, ChevronRight, FileDiff, FilePlus } from 'lucide-react';
import type { Conversation } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { PlanMark, planProgress, SUBAGENT_STATUS, ToolRow, type TimelineContext } from '../code/CodeTimeline.tsx';
import { fileChanges, latestPlan, relativePath, subagentDetail, threadSubagents, type FileChange, type Subagent } from '../code/workLog.ts';
import { primaryAgent } from '../lib/display.ts';
import { useStore } from '../lib/store.ts';
import { DeleteButton } from './DeleteButton.tsx';

// The Code thread's right panel, after T3 Code's tabbed right panel and its changed-files tree:
// the agent's latest plan, the files this thread changed with their diffs, and its subagents.

type Tab = 'plan' | 'changes' | 'subagents' | 'thread';

const TAB_LABEL: Record<Tab, string> = { plan: 'Plan', changes: 'Changes', subagents: 'Subagents', thread: 'Thread' };

function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums" aria-label={`${added} added, ${removed} removed`}>
      <span className="text-add">+{added}</span> <span className="text-del">-{removed}</span>
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

function Changes({ changes, root }: { changes: FileChange[]; root: string | undefined }) {
  if (changes.length === 0) return <p className="px-4 py-3 text-[13px] text-muted">No file changes yet</p>;
  const added = changes.reduce((sum, c) => sum + c.added, 0);
  const removed = changes.reduce((sum, c) => sum + c.removed, 0);
  return (
    <div className="px-2 py-2">
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
    </div>
  );
}

function Plan({ conversation }: { conversation: Conversation }) {
  const thread = useStore((s) => s.threads[conversation.id]);
  const plan = latestPlan(thread?.messages ?? []);
  if (!plan) return <p className="px-4 py-3 text-[13px] text-muted">No plan yet</p>;
  const { done, total } = planProgress(plan);
  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-[12px] text-muted">
        {done} of {total} done
      </p>
      <ul className="flex flex-col gap-1.5 text-[13px] leading-5">
        {plan.entries.map((entry, index) => (
          <li key={index} className={`flex items-start gap-2 ${entry.status === 'completed' ? 'text-muted' : ''}`}>
            <PlanMark status={entry.status} />
            <span className="min-w-0">{entry.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubagentItem({ agent, context }: { agent: Subagent; context: TimelineContext }) {
  const [open, setOpen] = useState(false);
  const status = SUBAGENT_STATUS[agent.status];
  const detail = subagentDetail(agent);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover">
        <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-field text-muted" aria-hidden>
          <Bot size={13} />
          <span className={`absolute -bottom-px -right-px size-2 rounded-full ring-2 ring-bg ${status.dot}`} />
        </span>
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

function ThreadInfo({ conversation }: { conversation: Conversation }) {
  const agents = useStore((s) => s.agents);
  const project = useStore((s) => (conversation.projectId ? s.projects[conversation.projectId] : undefined));
  const agent = primaryAgent(conversation, agents);
  return (
    <>
      <div className="px-4 pb-3 pt-4">
        <p className="text-[13px] text-muted">Project</p>
        <p className="text-[15px] font-semibold">{project?.name}</p>
        <p className="break-all font-mono text-[12px] text-muted">{project?.path}</p>
      </div>
      {agent && (
        <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
          <Avatar avatar={agent.avatar} size={30} />
          <div className="min-w-0">
            <p className="truncate text-[14px]">{agent.name}</p>
            {agent.runtimeLabel !== agent.name && <p className="truncate text-[12px] text-muted">{agent.runtimeLabel}</p>}
          </div>
        </div>
      )}
      <DeleteButton conversation={conversation} label="Delete thread" />
    </>
  );
}

export function CodePanel({ conversation }: { conversation: Conversation }) {
  const thread = useStore((s) => s.threads[conversation.id]);
  const agents = useStore((s) => s.agents);
  const project = useStore((s) => (conversation.projectId ? s.projects[conversation.projectId] : undefined));
  const catalogId = agents[conversation.memberIds[0]]?.catalogId ?? null;
  const messages = thread?.messages;
  const changes = useMemo(() => fileChanges(messages ?? []), [messages]);
  const subagents = useMemo(() => threadSubagents(messages ?? [], catalogId), [messages, catalogId]);
  const hasPlan = useMemo(() => latestPlan(messages ?? []) !== null, [messages]);
  const [chosen, setChosen] = useState<Tab | null>(null);

  // Plan and Subagents appear when the agent reported one; Changes and Thread are always there.
  const tabs: Tab[] = [...(hasPlan ? (['plan'] as const) : []), 'changes', ...(subagents.length > 0 ? (['subagents'] as const) : []), 'thread'];
  const tab: Tab = chosen && tabs.includes(chosen) ? chosen : hasPlan ? 'plan' : 'changes';
  const context: TimelineContext = { catalogId, root: project?.path };
  const count: Partial<Record<Tab, number>> = { changes: changes.length, subagents: subagents.length };

  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    setChosen(next);
    document.getElementById(`code-tab-${next}`)!.focus();
  };

  return (
    <div className="flex min-h-full flex-col">
      <div role="tablist" aria-label="Thread details" onKeyDown={onKey} className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-0.5 border-b border-line bg-bg px-2">
        {tabs.map((t) => (
          <button
            key={t}
            id={`code-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={t === tab}
            aria-controls="code-tab-panel"
            tabIndex={t === tab ? 0 : -1}
            onClick={() => setChosen(t)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] ${t === tab ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            {TAB_LABEL[t]}
            {count[t] ? <span className="text-[11px] tabular-nums text-muted">{count[t]}</span> : null}
          </button>
        ))}
      </div>
      <div id="code-tab-panel" role="tabpanel" aria-labelledby={`code-tab-${tab}`} className="min-h-0 flex-1">
        {tab === 'plan' && <Plan conversation={conversation} />}
        {tab === 'changes' && <Changes changes={changes} root={project?.path} />}
        {tab === 'subagents' && (
          <ul className="px-2 py-2">
            {subagents.map((agent) => (
              <SubagentItem key={agent.key} agent={agent} context={context} />
            ))}
          </ul>
        )}
        {tab === 'thread' && <ThreadInfo conversation={conversation} />}
      </div>
    </div>
  );
}
