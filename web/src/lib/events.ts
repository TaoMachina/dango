import type { HubEvent, Part } from '../../../shared/types.ts';
import { loadState, select, storeAgentOptions, storeSession, upsertMessage } from './actions.ts';
import { fixtureMode } from './api.ts';
import { getState, remove, setState, updateThread, upsert } from './store.ts';

export function applyEvent(event: HubEvent) {
  switch (event.type) {
    case 'hello':
      // Events may have been missed while disconnected: reload state and drop cached threads.
      // Open conversations refetch their messages when their thread disappears.
      setState(() => ({ threads: {} }));
      void loadState();
      return;
    case 'agent.upsert':
      return upsert('agents', event.agent);
    case 'agent.removed':
      return remove('agents', event.agentId);
    case 'conversation.upsert':
      return upsert('conversations', event.conversation);
    case 'conversation.removed': {
      remove('conversations', event.conversationId);
      const ui = getState().ui;
      if (ui.selected[ui.module] === event.conversationId) select(ui.module, null);
      return;
    }
    case 'project.upsert':
      return upsert('projects', event.project);
    case 'project.removed':
      return remove('projects', event.projectId);
    case 'message.upsert':
      return upsertMessage(event.message);
    case 'message.append':
      return updatePart(event.conversationId, event.messageId, event.partIndex, (part) => {
        if (part.type !== 'text' && part.type !== 'thought') throw new Error(`message.append to a ${part.type} part`);
        return { ...part, text: part.text + event.text };
      });
    case 'message.part':
      return updatePart(event.conversationId, event.messageId, event.partIndex, () => event.part);
    case 'run.upsert':
      return updateThread(event.run.conversationId, (t) => ({ ...t, runs: { ...t.runs, [event.run.id]: event.run } }));
    case 'session.upsert':
      return storeSession(event.session);
    case 'agent.options':
      return storeAgentOptions(event.options);
    case 'routine.upsert':
      return upsert('routines', event.routine);
    case 'routine.removed':
      return remove('routines', event.routineId);
  }
}

function updatePart(conversationId: string, messageId: string, index: number, recipe: (part: Part) => Part) {
  updateThread(conversationId, (t) => {
    const at = t.messages.findIndex((m) => m.id === messageId);
    // The message arrives with message.upsert first; before the thread is fetched it is not cached.
    if (at < 0) return t;
    const message = t.messages[at];
    const parts = message.parts.slice();
    parts[index] = recipe(parts[index]);
    const messages = t.messages.slice();
    messages[at] = { ...message, parts };
    return { ...t, messages };
  });
}

let source: EventSource | null = null;

export function closeEvents() {
  source?.close();
}

export function connectEvents() {
  if (import.meta.env.DEV && fixtureMode) {
    void import('../dev/fixture.ts').then((m) => m.fixtureEvents(applyEvent));
    return;
  }
  source = new EventSource('/api/events');
  source.onmessage = (e: MessageEvent<string>) => applyEvent(JSON.parse(e.data) as HubEvent);
  // A 401 makes the browser stop retrying; check whether the session is still valid.
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) void loadState();
  };
}
