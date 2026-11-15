import type { Agent, Message, Part, Run } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { fullTime } from '../lib/time.ts';
import { ErrorPart, ImagePart, PermissionPart, PlanPart, ThoughtPart, ToolPart } from './parts.tsx';

function PartView({ part, mine }: { part: Part; mine: boolean }) {
  switch (part.type) {
    case 'text':
      return (
        <div className={`max-w-[min(85%,640px)] rounded-[18px] px-4 py-2.5 text-[15px] leading-6 ${mine ? 'bg-bubble-user' : 'bg-bubble'}`}>
          <Markdown text={part.text} />
        </div>
      );
    case 'thought':
      return <ThoughtPart part={part} />;
    case 'tool':
      return <ToolPart part={part} />;
    case 'plan':
      return <PlanPart part={part} />;
    case 'permission':
      return <PermissionPart part={part} />;
    case 'image':
      return <ImagePart part={part} />;
    case 'error':
      return <ErrorPart text={part.text} />;
  }
}

function Typing() {
  return (
    <div className="flex h-10 w-16 items-center justify-center gap-1 rounded-[18px] bg-bubble" aria-label="Typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot size-1.5 rounded-full bg-muted" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

interface Props {
  message: Message;
  agent: Agent | undefined;
  showHeader: boolean;
  triggeredBy: string | null;
  run: Run | undefined;
}

export function MessageItem({ message, agent, showHeader, triggeredBy, run }: Props) {
  if (message.author.type === 'system') {
    const text = message.parts.map((p) => ('text' in p ? p.text : '')).join(' ');
    // System lines can link to other conversations, so they use the Markdown renderer too.
    return <div className="my-3 text-center text-[13px] text-muted"><Markdown text={text} /></div>;
  }

  const mine = message.author.type === 'user';
  const hasError = message.parts.some((p) => p.type === 'error');
  return (
    <div className={`flex flex-col gap-1.5 ${mine ? 'items-end' : 'items-start'} ${showHeader ? 'mt-4' : 'mt-1.5'}`} title={fullTime(message.createdAt)}>
      {showHeader && agent && (
        <div className="flex items-center gap-2 text-[13px]">
          <Avatar avatar={agent.avatar} size={22} />
          <span className="font-medium">{agent.name}</span>
          {triggeredBy && <span className="text-muted">→ triggered by @{triggeredBy}</span>}
        </div>
      )}
      {message.parts.map((part, index) => (
        <PartView key={index} part={part} mine={mine} />
      ))}
      {message.status === 'streaming' && message.parts.length === 0 && <Typing />}
      {message.status === 'stopped' && <p className="text-[12px] text-muted">Stopped</p>}
      {message.status === 'error' && !hasError && run?.error && <ErrorPart text={run.error} />}
    </div>
  );
}
