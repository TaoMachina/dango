import { useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Bot,
  Brain,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  FilePen,
  FileText,
  Globe,
  Search,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { Part, ToolContent } from '../../../shared/types.ts';
import { DiffView } from '../components/DiffView.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Spinner } from '../components/ui.tsx';
import { LIVE_STATE } from '../code/workLog.ts';
import { answerPermission } from '../lib/actions.ts';

type PartOf<T extends Part['type']> = Extract<Part, { type: T }>;

export function ThoughtPart({ part }: { part: PartOf<'thought'> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full max-w-[min(85%,640px)] text-[13px] text-muted">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded-md py-0.5 pr-1.5 hover:text-fg">
        <ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        Thinking
      </button>
      {open && <div className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-3 leading-5">{part.text}</div>}
    </div>
  );
}

const TOOL_ICON: Record<string, typeof Wrench> = {
  read: FileText,
  edit: FilePen,
  delete: Trash2,
  move: ArrowRightLeft,
  search: Search,
  execute: SquareTerminal,
  think: Brain,
  fetch: Globe,
};

function ToolContentView({ content }: { content: ToolContent }) {
  switch (content.type) {
    case 'diff':
      return <DiffView path={content.path} oldText={content.oldText} newText={content.newText} />;
    case 'text':
      return <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-bg px-3 py-2 font-mono text-[12px] leading-5">{content.text}</pre>;
    case 'image':
      return <img src={`data:${content.mimeType};base64,${content.data}`} alt="" className="max-h-80 rounded-xl border border-line" />;
    case 'terminal':
      return <p className="text-[12px] text-muted">Terminal output stays in the agent.</p>;
  }
}

export function ToolPart({ part, streaming }: { part: PartOf<'tool'>; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[part.kind] ?? Wrench;
  const expandable = part.content.length > 0 || part.locations.length > 0;
  return (
    <div id={`tool-${part.toolCallId}`} className="w-full max-w-[min(85%,640px)] scroll-mt-4 rounded-lg text-[13px]">
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-muted hover:text-fg disabled:hover:text-muted"
      >
        <Icon size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-fg/80">{part.title}</span>
        {/* A step left open in a finished reply shows no state: it neither ran on nor reported an end. */}
        {part.status === 'completed' ? (
          <Check size={14} className="shrink-0 text-success" aria-label="Done" />
        ) : part.status === 'failed' ? (
          <X size={14} className="shrink-0 text-danger" aria-label="Failed" />
        ) : (
          streaming && <Spinner size={13} />
        )}
      </button>
      {open && (
        <div className="mb-1 ml-6 mt-1 flex flex-col gap-2">
          {part.locations.length > 0 && !part.content.some((c) => c.type === 'diff') && <p className="truncate font-mono text-[12px] text-muted">{part.locations.join(', ')}</p>}
          {part.content.map((content, index) => (
            <ToolContentView key={index} content={content} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PlanPart({ part }: { part: PartOf<'plan'> }) {
  return (
    <div className="w-full max-w-[min(85%,640px)] rounded-2xl border border-line px-3 py-2">
      <p className="mb-1 text-[13px] text-muted">Plan</p>
      <ul className="flex flex-col gap-1 text-[14px]">
        {part.entries.map((entry, index) => (
          <li key={index} className="flex items-start gap-2">
            <span className="mt-[3px] text-muted">
              {entry.status === 'completed' ? (
                <CircleCheck size={15} className="text-success" aria-label="Done" />
              ) : entry.status === 'in_progress' ? (
                <Spinner size={15} />
              ) : (
                <Circle size={15} aria-label="To do" />
              )}
            </span>
            <span className={entry.status === 'completed' ? 'text-muted' : ''}>{entry.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PermissionPart({ part }: { part: PartOf<'permission'> }) {
  const [sending, setSending] = useState<string | null>(null);
  const outcome = part.outcome;
  const chosen = outcome && 'optionId' in outcome ? part.options.find((o) => o.optionId === outcome.optionId) : null;
  return (
    <div className="max-w-[min(85%,560px)] rounded-[18px] bg-bubble px-4 py-3">
      <div className="mb-2">
        <Markdown text={part.title} />
      </div>
      {outcome ? (
        <div className="flex h-10 items-center gap-2 rounded-xl border border-line bg-bg px-3 text-[14px] text-muted">
          <span className="flex-1">{chosen ? chosen.name : 'Cancelled'}</span>
          <Check size={15} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5" role="group" aria-label="Choose an option">
          {part.options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              disabled={sending !== null}
              onClick={() => {
                setSending(option.optionId);
                void answerPermission(part.requestId, option.optionId).catch(() => setSending(null));
              }}
              className={`flex h-10 items-center gap-2 rounded-xl border border-line bg-bg px-3 text-left text-[14px] hover:border-faint disabled:opacity-60 ${option.kind.startsWith('reject') ? 'text-muted' : ''}`}
            >
              <span className="flex-1">{option.name}</span>
              {sending === option.optionId && <Spinner />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A subagent in a chat: its title, latest step and state, in the same quiet line as a tool call. */
export function SubagentPart({ part }: { part: PartOf<'subagent'> }) {
  const line = part.activity ?? part.description;
  return (
    <div className="flex w-full max-w-[min(85%,640px)] items-center gap-2 px-1 py-1 text-[13px] text-muted">
      <Bot size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-fg/80">{part.title ?? 'Subagent'}</span>
        {line && <span className="ml-2">{line}</span>}
      </span>
      {part.state === 'running' ? <Spinner size={13} /> : <span className="shrink-0 text-[12px]">{LIVE_STATE[part.state].label}</span>}
    </div>
  );
}

export function ErrorPart({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[14px] text-danger">
      <AlertCircle size={15} className="mt-[3px] shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

export function ImagePart({ part }: { part: PartOf<'image'> }) {
  return <img src={`data:${part.mimeType};base64,${part.data}`} alt="" className="max-h-96 max-w-[min(85%,480px)] rounded-[18px] border border-line" />;
}
