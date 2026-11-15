import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowUp, Square } from 'lucide-react';

export interface Suggestion {
  key: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
}

interface Props {
  value: string;
  onChange: (value: string, caret: number) => void;
  onSubmit: () => void;
  placeholder: string;
  running?: boolean;
  onStop?: () => void;
  suggestions?: Suggestion[];
  onPick?: (suggestion: Suggestion) => void;
  onDismiss?: () => void;
  autoFocus?: boolean;
  busy?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

/** The pill composer: auto-growing text and a round send button that turns into Stop. */
export function ComposerBox(props: Props) {
  const { value, onChange, onSubmit, placeholder, running, onStop, suggestions = [], onPick, onDismiss, autoFocus, busy } = props;
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = props.textareaRef ?? ownRef;
  const [active, setActive] = useState(0);
  const showStop = running && !value.trim();
  const canSend = value.trim().length > 0 && !busy;

  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = 'auto';
    // An empty box keeps one row; a long placeholder must not grow it.
    if (value) el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);

  useLayoutEffect(() => setActive(0), [suggestions.length]);

  return (
    <div className="relative">
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 bottom-full mb-2 max-h-64 overflow-y-auto rounded-2xl border border-line bg-bg p-1.5 shadow-pop"
        >
          {suggestions.map((s, index) => (
            <li key={s.key} role="option" aria-selected={index === active}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick?.(s)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] ${index === active ? 'bg-selected' : 'hover:bg-hover'}`}
              >
                {s.icon}
                <span className="shrink-0 font-medium">{s.label}</span>
                {s.detail && <span className="min-w-0 truncate text-[13px] text-muted">{s.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1.5 rounded-[26px] border border-line bg-bg p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] focus-within:border-faint">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setActive((active + step + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                onPick?.(suggestions[active]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onDismiss?.();
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          // Cap the height so the conversation above stays visible.
          className="max-h-[40dvh] min-h-9 flex-1 resize-none bg-transparent py-[7px] pl-2.5 pr-1 text-[15px] leading-[22px] text-fg placeholder:text-muted focus-visible:outline-none"
        />
        {showStop ? (
          <button
            type="button"
            aria-label="Stop"
            title="Stop"
            onClick={onStop}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg hover:opacity-85"
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            title="Send"
            disabled={!canSend}
            onClick={onSubmit}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity hover:opacity-85 disabled:opacity-25"
          >
            <ArrowUp size={18} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  );
}
