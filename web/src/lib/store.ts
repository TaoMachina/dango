import { useSyncExternalStore } from 'react';
import type {
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
  toasts: [],
  ui: {
    module: startModule,
    selected: { chat: null, code: null, [startModule]: params.get('c') },
    newThreadProjectId: null,
    listCollapsed: localStorage.getItem('agentry.listCollapsed') === '1',
    panelOpen: localStorage.getItem('agentry.panelOpen') !== '0',
    drawer: null,
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

export function updateThread(id: ID, recipe: (t: Thread) => Thread) {
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
