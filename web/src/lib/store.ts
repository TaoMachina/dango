import { useSyncExternalStore } from 'react';
import type {
  AgentOptions,
  Agent,
  Conversation,
  Environment,
  ID,
  Message,
  Project,
  Routine,
  Run,
  SessionInfo,
} from '../../../shared/types.ts';

export type Module = 'chat' | 'code';
export type Drawer = 'list' | 'panel' | null;

export interface Thread {
  messages: Message[];
  runs: Record<ID, Run>;
  hasMore: boolean;
}

export interface Toast {
  id: number;
  text: string;
}

export interface UI {
  module: Module;
  selected: Record<Module, ID | null>;
  newThreadProjectId: ID | null;
  listCollapsed: boolean; // wide screens
  panelOpen: boolean; // wide screens
  drawer: Drawer; // narrow screens
  highlight: ID | null; // a message the timeline flashes after a jump to it
}

export interface State {
  auth: 'loading' | 'ok' | 'unauthorized' | 'closed';
  environments: Environment[];
  agents: Record<ID, Agent>;
  conversations: Record<ID, Conversation>;
  projects: Record<ID, Project>;
  routines: Record<ID, Routine>;
  threads: Record<ID, Thread>;
  sessions: Record<string, SessionInfo>;
  agentOptions: Record<ID, AgentOptions>; // what a new Code thread can pick per agent
  toasts: Toast[];
  ui: UI;
}

const params = new URLSearchParams(location.search);
const startModule: Module = params.get('m') === 'code' ? 'code' : 'chat';

let state: State = {
  auth: 'loading',
  environments: [],
  agents: {},
  conversations: {},
  projects: {},
  routines: {},
  threads: {},
  sessions: {},
  agentOptions: {},
  toasts: [],
  ui: {
    module: startModule,
    selected: { chat: null, code: null, [startModule]: params.get('c') },
    newThreadProjectId: null,
    listCollapsed: localStorage.getItem('agentry.listCollapsed') === '1',
    panelOpen: localStorage.getItem('agentry.panelOpen') !== '0',
    drawer: null,
    highlight: null,
  },
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState() {
  return state;
}

export function setState(recipe: (s: State) => Partial<State>) {
  state = { ...state, ...recipe(state) };
  for (const listener of listeners) listener();
}

/** Select a stable slice of the store. Selectors must return existing references, not new objects. */
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export function byId<T extends { id: ID }>(items: T[]): Record<ID, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

type Collection = 'agents' | 'conversations' | 'projects' | 'routines';

export function upsert<K extends Collection>(key: K, item: State[K][ID]) {
  setState((s) => ({ [key]: { ...s[key], [item.id]: item } }));
}

export function remove(key: Collection, id: ID) {
  setState((s) => {
    const next = { ...s[key] };
    delete next[id];
    return { [key]: next };
  });
}

export function updateUI(patch: Partial<UI>) {
  setState((s) => ({ ui: { ...s.ui, ...patch } }));
}

// Threads whose messages are being fetched. Events for them collect here and merge into the fetched page,
// so a message or run that starts while the page loads is not lost. Fetches of one thread can overlap
// (React's StrictMode runs the opening effect twice), so they share one buffer.
const fetching = new Map<ID, { thread: Thread; fetches: number }>();

export function startFetch(id: ID) {
  const pending = fetching.get(id);
  if (pending) pending.fetches++;
  else fetching.set(id, { thread: { messages: [], runs: {}, hasMore: false }, fetches: 1 });
}

/** What arrived over the event stream since the first overlapping startFetch. */
export function endFetch(id: ID): Thread {
  const pending = fetching.get(id)!;
  if (--pending.fetches === 0) fetching.delete(id);
  return pending.thread;
}

export function updateThread(id: ID, recipe: (t: Thread) => Thread) {
  const pending = fetching.get(id);
  if (pending) {
    pending.thread = recipe(pending.thread);
    return;
  }
  setState((s) => {
    const thread = s.threads[id];
    return thread ? { threads: { ...s.threads, [id]: recipe(thread) } } : {};
  });
}

export function sessionKey(conversationId: ID, agentId: ID) {
  return `${conversationId}:${agentId}`;
}

let toastId = 0;

export function toast(text: string) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text }] }));
}

export function dismissToast(id: number) {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
