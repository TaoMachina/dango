import { randomInt } from 'node:crypto';
import type { Agent, Avatar } from '../../shared/types.ts';
import type { Events } from '../events.ts';
import { newId, publicMessage, type Store } from '../store.ts';
import { isInstalled, type CatalogEntry } from './catalog.ts';

// Blob avatar colors, the same set the web avatar picker offers (web/src/components/Avatar.tsx).
// The web app draws shapes 0-5 and faces 0-4.
const PALETTE = ['#FF5A4E', '#FF8A3D', '#FFB938', '#3CC48F', '#2FB5C9', '#4C8DF6', '#7B6CF6', '#E66BB3', '#2B2B2E'];
const SHAPES = 6;
const FACES = 5;

// Well-known agents start with a face people recognize at a glance.
const KNOWN: Record<string, Avatar> = {
  'claude-code': { kind: 'blob', color: '#FF8A3D', shape: 3, face: 1 },
  codex: { kind: 'blob', color: '#2B2B2E', shape: 0, face: 0 },
  gemini: { kind: 'blob', color: '#4C8DF6', shape: 2, face: 2 },
};

// Picks a known avatar, else a color no other agent uses yet, so the list stays easy to scan.
export function defaultAvatar(catalogId: string | null, used: Avatar[]): Avatar {
  if (catalogId && KNOWN[catalogId]) return KNOWN[catalogId];
  const taken = new Set(used.flatMap(a => (a.kind === 'blob' ? [a.color] : [])));
  const free = PALETTE.filter(c => !taken.has(c));
  const colors = free.length ? free : PALETTE;
  return { kind: 'blob', color: colors[randomInt(colors.length)], shape: randomInt(SHAPES), face: randomInt(FACES) };
}

// Every agent gets one persistent chat, created with it.
export function createAgentWithChat(store: Store, events: Events, fields: Pick<Agent, 'name' | 'source' | 'catalogId' | 'runtimeLabel' | 'status'>): Agent {
  const id = newId();
  const chat = store.insertConversation({ kind: 'chat', title: fields.name, avatar: null, memberIds: [], leadId: null, projectId: null, hopLimit: 0 });
  store.insertAgent({
    ...fields, id, avatar: defaultAvatar(fields.catalogId, store.listAgents().map(a => a.avatar)), description: '', environmentId: 'local', statusDetail: null, hidden: false, chatId: chat.id,
  });
  store.setMembers(chat.id, [id]);
  const agent = store.getAgent(id)!;
  events.emit({ type: 'agent.upsert', agent });
  if (fields.source === 'acp') {
    const message = store.insertMessage({ conversationId: chat.id, author: { type: 'system' }, parts: [{ type: 'text', text: `${agent.name} is connected on this computer.` }], status: 'done' });
    events.emit({ type: 'message.upsert', message: publicMessage(message) });
  }
  events.emit({ type: 'conversation.upsert', conversation: store.getConversation(chat.id)! });
  return agent;
}

// Adds newly installed agents and marks missing ones offline. Names and avatars the person chose stay.
export function rescan(store: Store, events: Events, catalog: CatalogEntry[]): Agent[] {
  const existing = store.listAgents();
  for (const entry of catalog) {
    const agent = existing.find(a => a.source === 'acp' && a.catalogId === entry.id);
    const installed = isInstalled(entry);
    if (installed && !agent) {
      createAgentWithChat(store, events, { name: entry.runtimeLabel, source: 'acp', catalogId: entry.id, runtimeLabel: entry.runtimeLabel, status: 'available' });
    } else if (agent && installed && agent.status === 'offline') {
      events.emit({ type: 'agent.upsert', agent: store.updateAgent(agent.id, { status: 'available', statusDetail: null }) });
    } else if (agent && !installed && agent.status !== 'offline') {
      events.emit({ type: 'agent.upsert', agent: store.updateAgent(agent.id, { status: 'offline', statusDetail: `${entry.runtimeLabel} was not found on this computer.` }) });
    }
  }
  return store.listAgents();
}
