import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MemberModelPicker } from '../conversation/SessionPickers.tsx';
import { Crown, Minus, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import type { Avatar as AvatarData, Conversation, ID } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { EditableText } from '../components/EditableText.tsx';
import { Popover, usePopover } from '../components/Popover.tsx';
import { Button, IconButton, MenuItem, SectionTitle, Switch } from '../components/ui.tsx';
import { openSession, patchAgent, patchConversation, removeAgent } from '../lib/actions.ts';
import { conversationAvatar, primaryAgent, STATUS_COLOR, STATUS_LABEL } from '../lib/display.ts';
import { useStore } from '../lib/store.ts';
import { AvatarPicker } from './AvatarPicker.tsx';
import { CodePanel } from './CodePanel.tsx';
import { DeleteButton } from './DeleteButton.tsx';
import { Routines } from './Routines.tsx';

function Identity({ avatar, name, label, onAvatar, onName, children }: { avatar: AvatarData; name: string; label: string; onAvatar: (a: AvatarData) => void; onName: (n: string) => void; children?: ReactNode }) {
  const pop = usePopover();
  return (
    <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-6 text-center">
      <button
        ref={pop.anchor}
        type="button"
        aria-label="Change avatar"
        title="Change avatar"
        aria-expanded={pop.open !== null}
        onClick={() => pop.setOpen(pop.open ? null : 'open')}
        className="rounded-full transition-transform hover:scale-105"
      >
        <Avatar avatar={avatar} size={88} />
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} onClose={pop.close} label="Avatar" width={320}>
          <AvatarPicker value={avatar} onChange={onAvatar} />
        </Popover>
      )}
      <EditableText value={name} label={label} onSave={onName} className="max-w-full text-[18px] font-semibold" />
      {children}
    </div>
  );
}

function AgentPanel({ conversation }: { conversation: Conversation }) {
  const agents = useStore((s) => s.agents);
  const environments = useStore((s) => s.environments);
  const agent = primaryAgent(conversation, agents)!;
  const environment = environments.find((e) => e.id === agent.environmentId);
  const [description, setDescription] = useState<string | null>(null);

  return (
    <>
      <Identity
        avatar={agent.avatar}
        name={agent.name}
        label="Agent name"
        onAvatar={(avatar) => void patchAgent(agent.id, { avatar })}
        onName={(name) => void patchAgent(agent.id, { name })}
      >
        <p className="text-[13px] text-muted">
          {agent.runtimeLabel}
          {/* A url agent runs at its API host, not on this computer. */}
          {agent.source !== 'url' && environment && ` · ${environment.name}`}
        </p>
        {agent.apiHost && <p className="break-all text-[13px] text-muted">{agent.apiHost}</p>}
        <p className="flex items-center gap-1.5 text-[13px] text-muted">
          <span className={`size-2 rounded-full ${STATUS_COLOR[agent.status]}`} />
          {STATUS_LABEL[agent.status]}
        </p>
        {agent.statusDetail && <p className="text-[13px] text-warn">{agent.statusDetail}</p>}
      </Identity>
      <div className="px-4 pb-3">
        <textarea
          aria-label="Description"
          rows={2}
          value={description ?? agent.description}
          placeholder="Add a description"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== null && description !== agent.description) void patchAgent(agent.id, { description });
            setDescription(null);
          }}
          className="w-full resize-none rounded-lg bg-transparent px-2 py-1.5 text-[14px] placeholder:text-faint hover:bg-hover focus:bg-field focus:outline-none focus-visible:outline-2"
        />
        <div className="flex items-center justify-between px-2 py-2 text-[14px]">
          <span>Hide from list</span>
          <Switch checked={agent.hidden} label="Hide from list" onChange={(hidden) => void patchAgent(agent.id, { hidden })} />
        </div>
      </div>
      <div className="border-t border-line px-2 py-2">
        <Routines conversation={conversation} />
      </div>
      {agent.source !== 'acp' && (
        // Installed agents leave when they are uninstalled; agents that joined by invitation or URL are removed here.
        <div className="border-t border-line p-3">
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              if (confirm(`Remove ${agent.name}? Its chat will be removed.`)) void removeAgent(agent);
            }}
          >
            <Trash2 size={15} /> Remove agent
          </Button>
        </div>
      )}
    </>
  );
}

function MemberMenu({ conversation, id }: { conversation: Conversation; id: ID }) {
  const pop = usePopover();
  const isLead = conversation.leadId === id;
  return (
    <>
      <IconButton ref={pop.anchor} label="Member options" className="size-7" aria-expanded={pop.open !== null} onClick={() => pop.setOpen(pop.open ? null : 'open')}>
        <MoreHorizontal size={16} />
      </IconButton>
      {pop.open && (
        <Popover anchor={pop.anchor} onClose={pop.close} label="Member options" width={200} align="end">
          <div className="p-1.5">
            {!isLead && (
              <MenuItem
                icon={<Crown size={15} className="text-muted" />}
                onClick={() => {
                  pop.close();
                  void patchConversation(conversation.id, { leadId: id });
                }}
              >
                Make lead
              </MenuItem>
            )}
            <MenuItem
              icon={<Trash2 size={15} className="text-muted" />}
              onClick={() => {
                pop.close();
                const memberIds = conversation.memberIds.filter((m) => m !== id);
                void patchConversation(conversation.id, isLead ? { memberIds, leadId: memberIds[0] ?? null } : { memberIds });
              }}
            >
              Remove
            </MenuItem>
          </div>
        </Popover>
      )}
    </>
  );
}

function GroupPanel({ conversation }: { conversation: Conversation }) {
  const agents = useStore((s) => s.agents);
  const add = usePopover();
  const others = useMemo(() => Object.values(agents).filter((a) => !conversation.memberIds.includes(a.id)), [agents, conversation.memberIds]);
  // Each member keeps its own session in this group; loading them shows each member's model and effort.
  const memberKey = conversation.memberIds.join(',');
  useEffect(() => {
    for (const id of conversation.memberIds) void openSession(conversation.id, id);
  }, [conversation.id, memberKey]);

  return (
    <>
      <Identity
        avatar={conversationAvatar(conversation, agents)}
        name={conversation.title}
        label="Group name"
        onAvatar={(avatar) => void patchConversation(conversation.id, { avatar })}
        onName={(title) => void patchConversation(conversation.id, { title })}
      />
      <div className="border-t border-line px-2 py-2">
        <SectionTitle
          action={
            others.length > 0 && (
              <IconButton ref={add.anchor} label="Add member" className="size-7" aria-expanded={add.open !== null} onClick={() => add.setOpen(add.open ? null : 'open')}>
                <Plus size={16} />
              </IconButton>
            )
          }
        >
          Members
        </SectionTitle>
        {add.open && (
          <Popover anchor={add.anchor} onClose={add.close} label="Add member" width={260} align="end">
            <div className="p-1.5">
              {others.map((agent) => (
                <MenuItem
                  key={agent.id}
                  icon={<Avatar avatar={agent.avatar} size={24} />}
                  onClick={() => {
                    add.close();
                    void patchConversation(conversation.id, { memberIds: [...conversation.memberIds, agent.id] });
                  }}
                >
                  {agent.name}
                </MenuItem>
              ))}
            </div>
          </Popover>
        )}
        <ul>
          {conversation.memberIds.map((id) => {
            const agent = agents[id];
            if (!agent) return null;
            const isLead = conversation.leadId === id;
            return (
              <li key={id} className="group/member flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-hover">
                <Avatar avatar={agent.avatar} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{agent.name}</span>
                  <MemberModelPicker conversationId={conversation.id} agentId={id} />
                </span>
                {isLead ? (
                  <span className="inline-flex h-7 items-center gap-1 rounded-full bg-field px-2.5 text-[12px]" title="Messages without an @mention go to the lead">
                    <Crown size={13} />
                    Lead
                  </span>
                ) : (
                  // Shown on hover or keyboard focus, at the spot where the lead badge sits, so switching is one click.
                  <IconButton
                    label={`Make ${agent.name} the lead`}
                    title="Make lead"
                    className="size-7 opacity-0 focus-visible:opacity-100 group-hover/member:opacity-100"
                    onClick={() => void patchConversation(conversation.id, { leadId: id })}
                  >
                    <Crown size={15} />
                  </IconButton>
                )}
                <MemberMenu conversation={conversation} id={id} />
              </li>
            );
          })}
        </ul>
        <p className="px-2 pt-1 text-[12px] text-muted">Messages go to the lead, who hands work to others and sums up. @name to ask someone directly.</p>
        <div className="mt-2 flex items-center justify-between gap-3 px-2 py-1.5 text-[14px]">
          <span className="min-w-0">
            <span id="handoff-label" className="block">Agent handoffs</span>
            <span id="handoff-help" className="block text-[12px] leading-4 text-muted">How many times agents can pass one message on to each other with @</span>
          </span>
          <div className="flex shrink-0 items-center gap-1" role="group" aria-labelledby="handoff-label" aria-describedby="handoff-help">
            <IconButton label="Fewer handoffs" className="size-7" disabled={conversation.hopLimit <= 0} onClick={() => void patchConversation(conversation.id, { hopLimit: conversation.hopLimit - 1 })}>
              <Minus size={14} />
            </IconButton>
            <span className="w-5 text-center tabular-nums">{conversation.hopLimit}</span>
            <IconButton label="More handoffs" className="size-7" onClick={() => void patchConversation(conversation.id, { hopLimit: conversation.hopLimit + 1 })}>
              <Plus size={14} />
            </IconButton>
          </div>
        </div>
      </div>
      <div className="border-t border-line px-2 py-2">
        <Routines conversation={conversation} />
      </div>
      <DeleteButton conversation={conversation} label="Delete group" />
    </>
  );
}

export function RightPanel({ conversation }: { conversation: Conversation }) {
  if (conversation.kind === 'group') return <GroupPanel conversation={conversation} />;
  if (conversation.kind === 'code') return <CodePanel conversation={conversation} />;
  return <AgentPanel conversation={conversation} />;
}
