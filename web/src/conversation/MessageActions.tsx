import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Bookmark, BookmarkCheck, Check, Copy, GitFork } from 'lucide-react';
import type { Message } from '../../../shared/types.ts';
import { Spinner } from '../components/ui.tsx';
import { forkThread, setChapter } from '../lib/actions.ts';
import { useMinuteClock } from '../lib/now.ts';
import { toast } from '../lib/store.ts';
import { agoTime, fullTime } from '../lib/time.ts';

// The quiet row under a finished agent message: its time,
// then actions that show on hover or keyboard focus (always on touch screens, which cannot hover).

// The copy confirmation shows for one second: long enough to notice, short enough not to linger.
const COPIED_MS = 1000;

/** The message's answer text as Markdown. */
export function messageMarkdown(message: Message) {
  return message.parts
    .flatMap((p) => (p.type === 'text' && p.text.trim() ? [p.text.trim()] : []))
    .join('\n\n');
}

function ActionButton({ label, title, onClick, pressed, disabled, children, ref }: { label: string; title?: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <ActionButton label={copied ? 'Copied' : label} onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), (e: Error) => toast(e.message))}>
      {copied ? <Check size={14} className="animate-pop text-success" /> : <Copy size={14} />}
    </ActionButton>
  );
}

function ChapterForm({ initial, onSave, onCancel }: { initial: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial);
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave(title.trim());
        else onCancel();
      }}
    >
      <input
        autoFocus
        aria-label="Chapter title"
        placeholder="Chapter title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        className="h-7 min-w-0 max-w-72 flex-1 rounded-md border border-line bg-bg px-2 text-[13px] text-fg placeholder:text-faint focus:border-faint focus:outline-none"
      />
      <button type="submit" className="h-7 rounded-md px-2 text-[13px] text-fg hover:bg-hover">
        Pin
      </button>
      <button type="button" onClick={onCancel} className="h-7 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg">
        Cancel
      </button>
    </form>
  );
}

interface Props {
  message: Message;
  // Code threads only: the first line of the prompt that started this turn, prefilled as the chapter title.
  chapterPrompt?: string;
  // Code threads only: set on the latest finished agent message, which is the only point a native session can be copied.
  forkFrom?: string; // the conversation to fork
}

export function MessageMeta({ message, chapterPrompt, forkFrom }: Props) {
  const now = useMinuteClock();
  const [pinning, setPinning] = useState(false);
  const [forking, setForking] = useState(false);
  const pinButton = useRef<HTMLButtonElement>(null);
  const wasPinning = useRef(false);
  // Closing the title form returns focus to the pin button, so keyboard users keep their place.
  useEffect(() => {
    if (wasPinning.current && !pinning) pinButton.current!.focus();
    wasPinning.current = pinning;
  }, [pinning]);
  const text = messageMarkdown(message);
  const pinnable = chapterPrompt !== undefined;

  return (
    <div className="flex min-h-7 min-w-0 items-center gap-1 text-[12px] text-muted">
      {message.chapter && (
        <span className="inline-flex min-w-0 items-center gap-1 font-medium text-fg/70">
          <BookmarkCheck size={13} className="shrink-0" aria-hidden />
          <span className="truncate">{message.chapter}</span>
          <span aria-hidden>·</span>
        </span>
      )}
      <time dateTime={message.createdAt} title={fullTime(message.createdAt)} className="shrink-0 tabular-nums">
        {agoTime(message.createdAt, now)}
      </time>
      {pinning ? (
        <ChapterForm
          initial={chapterPrompt ?? ''}
          onCancel={() => setPinning(false)}
          onSave={(title) => {
            setPinning(false);
            void setChapter(message.id, title);
          }}
        />
      ) : (
        <div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/turn:opacity-100 pointer-coarse:opacity-100">
          {text && <CopyButton text={text} />}
          {pinnable && (
            <ActionButton
              ref={pinButton}
              label={message.chapter ? 'Unpin chapter' : 'Pin as chapter'}
              pressed={message.chapter !== null}
              onClick={() => (message.chapter ? void setChapter(message.id, null) : setPinning(true))}
            >
              {message.chapter ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
            </ActionButton>
          )}
          {forkFrom && (
            <ActionButton
              label="Fork"
              title="Fork this thread into a new one with the same context"
              disabled={forking}
              onClick={() => {
                setForking(true);
                void forkThread(forkFrom, message.id).finally(() => setForking(false));
              }}
            >
              {forking ? <Spinner size={13} /> : <GitFork size={14} />}
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}
