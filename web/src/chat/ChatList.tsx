import { useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, UserPlus, Users } from 'lucide-react';
import type { Agent, Conversation } from '../../../shared/types.ts';
import { ListRow } from '../components/ListRow.tsx';
import { Popover, usePopover } from '../components/Popover.tsx';
import { IconButton, MenuItem, SectionTitle } from '../components/ui.tsx';
import { select } from '../lib/actions.ts';
import { conversationAvatar } from '../lib/display.ts';
import { useStore } from '../lib/store.ts';
import { relativeTime } from '../lib/time.ts';
import { AddAgentForm } from './AddAgentForm.tsx';
import { NewGroupForm } from './NewGroupForm.tsx';

function lastAt(conversation: Conversation | undefined) {
  return conversation?.lastMessage?.at ?? '';
}

function AgentSubtitle({ agent, conversation }: { agent: Agent; conversation: Conversation | undefined }) {
  if (agent.status === 'needs-auth') return <span className="text-warn">Needs sign-in</span>;
  if (agent.status === 'error') return <span className="text-danger">Error</span>;
  if (conversation?.activeRuns) return <span>Working…</span>;
  return <>{conversation?.lastMessage?.text ?? agent.runtimeLabel}</>;
}

export function ChatList() {
  const agents = useStore((s) => s.agents);
  const conversations = useStore((s) => s.conversations);
  const selected = useStore((s) => s.ui.selected.chat);
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const menu = usePopover<'menu' | 'group' | 'agent'>();

  const q = query.trim().toLowerCase();
  const matches = (text: string | undefined) => !q || (text ?? '').toLowerCase().includes(q);

  const { visible, hidden, groups } = useMemo(() => {
    const sorted = Object.values(agents).sort(
      (a, b) => lastAt(conversations[b.chatId]).localeCompare(lastAt(conversations[a.chatId])) || a.name.localeCompare(b.name),
    );
    return {
      visible: sorted.filter((a) => !a.hidden),
      hidden: sorted.filter((a) => a.hidden),
      groups: Object.values(conversations)
        .filter((c) => c.kind === 'group')
        .sort((a, b) => lastAt(b).localeCompare(lastAt(a)) || a.title.localeCompare(b.title)),
    };
  }, [agents, conversations]);

  const agentRow = (agent: Agent) => {
    const conversation = conversations[agent.chatId];
    if (!matches(agent.name) && !matches(conversation?.lastMessage?.text)) return null;
    return (
      <li key={agent.id}>
        <ListRow
          avatar={agent.avatar}
          title={agent.name}
          time={conversation?.lastMessage ? relativeTime(conversation.lastMessage.at) : undefined}
          subtitle={<AgentSubtitle agent={agent} conversation={conversation} />}
          selected={selected === agent.chatId}
          dimmed={agent.hidden}
          onClick={() => select('chat', agent.chatId)}
        />
      </li>
    );
  };

  const shownGroups = groups.filter((g) => matches(g.title) || matches(g.lastMessage?.text));

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <h1 className="text-[17px] font-semibold">Chat</h1>
        <IconButton ref={menu.anchor} label="New" aria-expanded={menu.open !== null} onClick={() => menu.setOpen(menu.open ? null : 'menu')}>
          <Plus size={18} />
        </IconButton>
        {menu.open === 'menu' && (
          <Popover anchor={menu.anchor} onClose={menu.close} label="New" width={220} align="end">
            <div className="p-1.5">
              <MenuItem icon={<Users size={16} className="text-muted" />} onClick={() => menu.setOpen('group')}>
                New group
              </MenuItem>
              <MenuItem icon={<UserPlus size={16} className="text-muted" />} onClick={() => menu.setOpen('agent')}>
                Add agent
              </MenuItem>
            </div>
          </Popover>
        )}
        {menu.open === 'group' && (
          <Popover anchor={menu.anchor} onClose={menu.close} label="New group" width={340} align="end">
            <NewGroupForm onDone={menu.close} />
          </Popover>
        )}
        {menu.open === 'agent' && (
          <Popover anchor={menu.anchor} onClose={menu.close} label="Add agent" width={360} align="end">
            <AddAgentForm />
          </Popover>
        )}
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-field px-2.5 text-muted focus-within:border-faint">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-fg placeholder:text-muted focus:outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ul>{visible.map(agentRow)}</ul>
        {shownGroups.length > 0 && (
          <>
            <SectionTitle>Groups</SectionTitle>
            <ul>
              {shownGroups.map((group) => (
                <li key={group.id}>
                  <ListRow
                    avatar={conversationAvatar(group, agents)}
                    title={group.title}
                    time={group.lastMessage ? relativeTime(group.lastMessage.at) : undefined}
                    subtitle={
                      group.activeRuns
                        ? 'Working…'
                        : group.lastMessage
                          ? `${group.lastMessage.authorName}: ${group.lastMessage.text}`
                          : `${group.memberIds.length} members`
                    }
                    selected={selected === group.id}
                    onClick={() => select('chat', group.id)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        {hidden.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={showHidden}
              onClick={() => setShowHidden(!showHidden)}
              className="mt-2 flex h-8 w-full items-center gap-1 rounded-lg px-2 text-[13px] text-muted hover:bg-hover"
            >
              <ChevronRight size={14} className={`transition-transform ${showHidden ? 'rotate-90' : ''}`} />
              <span className="flex-1 text-left">Hidden</span>
              <span>{hidden.length}</span>
            </button>
            {showHidden && <ul>{hidden.map(agentRow)}</ul>}
          </>
        )}
      </div>
    </>
  );
}
