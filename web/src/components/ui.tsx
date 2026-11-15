import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string; active?: boolean }>(
  function IconButton({ label, active, className = '', children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 ${active ? 'bg-selected text-fg' : ''} ${className}`}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }>(
  function Button({ variant = 'secondary', className = '', type = 'button', ...rest }, ref) {
    const look = {
      primary: 'bg-accent text-accent-fg hover:opacity-85',
      secondary: 'bg-field text-fg hover:bg-selected',
      ghost: 'text-fg hover:bg-hover',
      danger: 'text-danger hover:bg-hover',
    }[variant];
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition disabled:opacity-40 ${look} ${className}`}
        {...rest}
      />
    );
  },
);

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-success' : 'bg-faint'}`}
    >
      <span className={`absolute size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={`shrink-0 animate-spin ${className}`} aria-label="Working" />;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[13px] text-muted">
      {children}
    </label>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between px-2 text-[13px] text-muted">
      <span>{children}</span>
      {action}
    </div>
  );
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-bg px-3 text-[14px] text-fg placeholder:text-faint focus:border-faint focus:outline-none focus-visible:outline-2';

export const textareaClass =
  'w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[14px] text-fg placeholder:text-faint focus:border-faint focus:outline-none focus-visible:outline-2';

/** A list row inside a popover menu. */
export function MenuItem({ icon, children, onClick, active }: { icon?: ReactNode; children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] hover:bg-hover ${active ? 'bg-selected' : ''}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
