import type { ReactNode } from 'react';
import type { Avatar as AvatarData } from '../../../shared/types.ts';
import { Avatar } from './Avatar.tsx';

interface Props {
  avatar: AvatarData;
  title: string;
  time?: string;
  subtitle: ReactNode;
  selected: boolean;
  dimmed?: boolean;
  onClick: () => void;
}

/** A Grok Bot style list row: avatar, name, time, one line of preview. */
export function ListRow({ avatar, title, time, subtitle, selected, dimmed, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${selected ? 'bg-selected' : 'hover:bg-hover'} ${dimmed ? 'opacity-60' : ''}`}
    >
      <Avatar avatar={avatar} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{title}</span>
          {time && <span className="shrink-0 text-[12px] text-muted">{time}</span>}
        </span>
        <span className="block truncate text-[14px] text-muted">{subtitle}</span>
      </span>
    </button>
  );
}
