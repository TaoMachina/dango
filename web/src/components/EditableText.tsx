import { useState } from 'react';

interface Props {
  value: string;
  label: string;
  onSave: (value: string) => void;
  className?: string;
}

/** Text that turns into an input on click. Enter or blur saves; Escape cancels. */
export function EditableText({ value, label, onSave, className = '' }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        title={`Rename ${label.toLowerCase()}`}
        aria-label={`${label}: ${value}. Click to rename`}
        onClick={() => setDraft(value)}
        className={`min-w-0 truncate rounded-md px-1 text-left hover:bg-hover ${className}`}
      >
        {value}
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (next && next !== value) onSave(next);
  };

  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
      className={`min-w-0 rounded-md bg-field px-1 focus:outline-none focus-visible:outline-2 ${className}`}
    />
  );
}
