import { useMemo, useRef, useState } from 'react';
import type { Agent, Conversation, ID } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { sendMessage, stop } from '../lib/actions.ts';
import { conversationTitle, primaryAgent } from '../lib/display.ts';
import { useMedia } from '../lib/media.ts';
import { sessionKey, useStore } from '../lib/store.ts';
import { ComposerBox, type Suggestion } from './ComposerBox.tsx';
import { SessionControls } from './SessionPickers.tsx';

interface Draft {
  text: string;
  mentions: ID[];
}

// Unsent text per conversation, kept in memory while switching.
const drafts = new Map<ID, Draft>();

type Trigger = { kind: 'mention' | 'command'; query: string; start: number };

function findTrigger(text: string, caret: number, group: boolean): Trigger | null {
  const before = text.slice(0, caret);
  if (group) {
    const m = before.match(/(^|\s)@([^\s@]*)$/);
    if (m) return { kind: 'mention', query: m[2], start: caret - m[2].length - 1 };
  }
  const c = before.match(/^\/(\S*)$/);
  if (c) return { kind: 'command', query: c[1], start: 0 };
  return null;
}

export function Composer({ conversation }: { conversation: Conversation }) {
  const agents = useStore((s) => s.agents);
  const agent = primaryAgent(conversation, agents);
  const session = useStore((s) => (agent ? s.sessions[sessionKey(conversation.id, agent.id)] : undefined));
  const saved = drafts.get(conversation.id);
  const [text, setText] = useState(saved?.text ?? '');
  const [mentions, setMentions] = useState<ID[]>(saved?.mentions ?? []);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const group = conversation.kind === 'group';

  const members = useMemo(() => conversation.memberIds.map((id) => agents[id]).filter((a) => a !== undefined), [conversation.memberIds, agents]);
  const commands = session?.commands ?? [];

  const update = (value: string, nextMentions: ID[], caret: number) => {
    setText(value);
    setMentions(nextMentions);
    setTrigger(findTrigger(value, caret, group));
    drafts.set(conversation.id, { text: value, mentions: nextMentions });
  };

  const placeCaret = (position: number) => {
    requestAnimationFrame(() => {
      const el = textarea.current!;
      el.focus();
      el.setSelectionRange(position, position);
    });
  };

  const insertMention = (id: ID, base: string, start: number, end: number) => {
    const name = agents[id].name;
    const value = `${base.slice(0, start)}@${name} ${base.slice(end)}`;
    const caret = start + name.length + 2;
    update(value, mentions.includes(id) ? mentions : [...mentions, id], caret);
    setTrigger(null);
    placeCaret(caret);
  };

  const insertCommand = (name: string) => {
    const value = `/${name} `;
    update(value, mentions, value.length);
    setTrigger(null);
    placeCaret(value.length);
  };

  const suggestions: Suggestion[] = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    if (trigger.kind === 'mention') {
      return members
        .filter((m) => m.name.toLowerCase().includes(q))
        .map((m) => ({ key: m.id, label: m.name, detail: m.id === conversation.leadId ? 'Lead' : m.runtimeLabel, icon: <Avatar avatar={m.avatar} size={22} /> }));
    }
    return commands.filter((c) => c.name.toLowerCase().startsWith(q)).map((c) => ({ key: c.name, label: `/${c.name}`, detail: c.description }));
  }, [trigger, members, commands, conversation.leadId]);

  const submit = () => {
    const body = text.trim();
    const ids = mentions.filter((id) => body.includes(`@${agents[id]?.name}`));
    update('', [], 0);
    drafts.delete(conversation.id);
    void sendMessage(conversation.id, body, ids).catch(() => update(body, ids, body.length));
  };

  // Code thread titles are long; address the agent instead.
  const title = agent ? agent.name : conversationTitle(conversation, agents);
  // Focus on open only with a mouse or trackpad, so phones do not pop the keyboard.
  const finePointer = useMedia('(pointer: fine)');

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 pt-1 md:px-6 md:pb-4">
      <ComposerBox
        value={text}
        textareaRef={textarea}
        onChange={(value, caret) => update(value, mentions, caret)}
        onSubmit={submit}
        placeholder={`Message ${title}`}
        running={conversation.activeRuns > 0}
        onStop={() => void stop(conversation.id)}
        suggestions={suggestions}
        onPick={(s) => (trigger?.kind === 'mention' ? insertMention(s.key, text, trigger.start, textarea.current!.selectionStart) : insertCommand(s.key))}
        onDismiss={() => setTrigger(null)}
        autoFocus={finePointer}
      />
      {agent && <SessionControls conversationId={conversation.id} agentId={agent.id} />}
      {group && <Recipients conversation={conversation} members={members} text={text} />}
    </div>
  );
}

// Says who will answer before the message is sent: the @mentioned members, else the lead.
function Recipients({ conversation, members, text }: { conversation: Conversation; members: Agent[]; text: string }) {
  const lower = text.toLowerCase();
  const named = members.filter((m) => lower.includes(`@${m.name.toLowerCase()}`));
  const lead = members.find((m) => m.id === (conversation.leadId ?? conversation.memberIds[0]));
  const to = named.length > 0 ? named : lead ? [lead] : [];
  if (to.length === 0) return null;
  return (
    // 7px matches the composer's border and padding, like the session controls in chats.
    <p className="mt-1.5 flex h-7 items-center gap-1.5 px-[7px] text-[13px] text-muted">
      To
      {to.map((m) => (
        <span key={m.id} className="inline-flex items-center gap-1 text-fg">
          <Avatar avatar={m.avatar} size={16} />
          {m.name}
        </span>
      ))}
      {named.length === 0 && <span>· lead</span>}
    </p>
  );
}
