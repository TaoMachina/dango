// Maps ACP session updates onto Dango message parts and session settings.
import type * as acp from '@agentclientprotocol/sdk/unstable';
import type { ConversationKind, ID, Part, SessionInfo, SessionOption, ToolContent } from '../../shared/types.ts';
import type { LiveRun } from '../routing.ts';

export interface SessionState {
  configOptions: acp.SessionConfigOption[];
  // Agents without a "mode" config option may still report the older session modes.
  modes: acp.SessionModeState | null;
  commands: { name: string; description: string }[];
  usage: { used: number; size: number } | null;
}

// A value the person or the hub chose for one option in one conversation.
export interface Choice { optionId: string; value: string | boolean }

// The id under which session modes appear when the agent reports them only as `modes`.
export const LEGACY_MODE_ID = 'acp:mode';

export function stateFrom(response: { modes?: acp.SessionModeState | null; configOptions?: acp.SessionConfigOption[] | null }): SessionState {
  return { configOptions: response.configOptions ?? [], modes: response.modes ?? null, commands: [], usage: null };
}

function selectChoices(o: Extract<acp.SessionConfigOption, { type: 'select' }>) {
  return o.options.flatMap(c => ('group' in c ? c.options : [c]));
}

function optionFrom(o: acp.SessionConfigOption): SessionOption {
  const common = { id: o.id, name: o.name, description: o.description ?? null, category: o.category ?? null };
  if (o.type === 'boolean') return { ...common, type: 'boolean', currentValue: o.currentValue };
  const choices = selectChoices(o).map(c => ({ value: c.value, name: c.name, description: c.description ?? null }));
  return { ...common, type: 'select', currentValue: o.currentValue, choices };
}

// The agent's model option: category 'model', or an option named 'model' by an agent that leaves the category out.
function modelOption(configOptions: acp.SessionConfigOption[]) {
  const option = configOptions.find(o => o.category === 'model') ?? configOptions.find(o => o.id === 'model');
  return option?.type === 'select' ? option : null;
}

// The models an agent offers, as it names them.
export function modelChoices(configOptions: acp.SessionConfigOption[]): { value: string; name: string }[] {
  const option = modelOption(configOptions);
  return option ? selectChoices(option).map(c => ({ value: c.value, name: c.name })) : [];
}

// The name of the model a session reports as current; a subagent reports only its own model as the one choice.
export function currentModelName(configOptions: acp.SessionConfigOption[]): string | null {
  const option = modelOption(configOptions);
  if (!option) return null;
  return selectChoices(option).find(c => c.value === option.currentValue)?.name ?? option.currentValue;
}

// Every option the agent reports, with legacy modes as one more select.
export function allOptions(state: SessionState): SessionOption[] {
  const options = state.configOptions.map(optionFrom);
  if (state.modes && !options.some(o => o.category === 'mode')) {
    options.push({
      id: LEGACY_MODE_ID, name: 'Mode', description: null, category: 'mode', type: 'select', currentValue: state.modes.currentModeId,
      choices: state.modes.availableModes.map(m => ({ value: m.id, name: m.name, description: m.description ?? null })),
    });
  }
  return options;
}

// Claude Code reports its effort as 'thought_level'; an agent that leaves the category out still names it effort.
const isEffort = (o: SessionOption) => o.category === 'thought_level' || /effort/i.test(o.id);

// Chats and groups are for talking and delegating, so they show only model and effort.
// Code threads show model, effort and mode first, then the rest in the agent's order. null hides the option.
function rank(kind: ConversationKind, o: SessionOption): number | null {
  if (o.category === 'model') return 0;
  if (isEffort(o)) return 1;
  if (kind !== 'code') return null;
  return o.category === 'mode' ? 2 : 3;
}

// The web app finds the model and effort controls by category, so an option matched by its id reports that category.
function normalized(o: SessionOption): SessionOption {
  if (o.id === 'model' && o.category !== 'model') return { ...o, category: 'model' };
  if (isEffort(o) && o.category !== 'thought_level') return { ...o, category: 'thought_level' };
  return o;
}

export function sessionInfo(conversation: { id: ID; kind: ConversationKind }, agentId: ID, state: SessionState, ready: boolean): SessionInfo {
  const ranked = allOptions(state).map(normalized).flatMap(o => {
    const r = rank(conversation.kind, o);
    return r === null ? [] : [{ o, r }];
  });
  ranked.sort((a, b) => a.r - b.r);
  return { conversationId: conversation.id, agentId, options: ranked.map(x => x.o), commands: state.commands, usage: state.usage, ready };
}

// Whether `value` is one the option offers, and differs from its current value.
export function changes(state: SessionState, choice: Choice): boolean {
  const option = allOptions(state).find(o => o.id === choice.optionId);
  if (!option || option.currentValue === choice.value) return false;
  return option.type === 'boolean' ? typeof choice.value === 'boolean' : option.choices.some(c => c.value === choice.value);
}

// The state as it will be once the choices are applied; shown while the session is still starting.
export function withChoices(state: SessionState, choices: Choice[]): SessionState {
  const next: SessionState = structuredClone(state);
  for (const choice of choices) {
    if (!changes(next, choice)) continue;
    if (choice.optionId === LEGACY_MODE_ID) next.modes!.currentModeId = String(choice.value);
    else next.configOptions = next.configOptions.map(o => (o.id === choice.optionId ? { ...o, currentValue: choice.value } as acp.SessionConfigOption : o));
  }
  return next;
}

// Chats and groups turn fast mode off: Codex reports it as 'fast-mode', a model_config select of off/on.
export function chatDefaults(state: SessionState): Choice[] {
  return allOptions(state).flatMap((o): Choice[] => {
    if (o.category !== 'speed' && !/fast/i.test(o.id)) return [];
    if (o.type === 'boolean') return [{ optionId: o.id, value: false }];
    const off = o.choices.find(c => /^off$/i.test(c.value));
    return off ? [{ optionId: o.id, value: off.value }] : [];
  });
}

export function blockText(block: acp.ContentBlock): string | null {
  if (block.type === 'text') return block.text;
  if (block.type === 'resource_link') return `[${block.title ?? block.name}](${block.uri})`;
  if (block.type === 'resource' && 'text' in block.resource) return block.resource.text;
  return null;
}

function toolContent(content: acp.ToolCallContent): ToolContent | null {
  // A reference to a subagent's session; the subagent has its own part.
  if (content.type === 'session') return null;
  if (content.type === 'diff') return { type: 'diff', path: content.path, oldText: content.oldText ?? null, newText: content.newText };
  if (content.type === 'terminal') return { type: 'terminal', terminalId: content.terminalId };
  if (content.content.type === 'image') return { type: 'image', mimeType: content.content.mimeType, data: content.content.data };
  const text = blockText(content.content);
  return text === null ? null : { type: 'text', text };
}

export function upsertTool(live: LiveRun, update: acp.ToolCallUpdate | acp.ToolCall): Part {
  const index = live.parts.findIndex(p => p.type === 'tool' && p.toolCallId === update.toolCallId);
  const previous = index >= 0 ? live.parts[index] : null;
  const base = previous && previous.type === 'tool'
    ? previous
    : { type: 'tool' as const, toolCallId: update.toolCallId, title: '', kind: 'other', status: 'pending' as const, locations: [], content: [] };
  const part: Part = {
    ...base,
    title: update.title ?? base.title,
    kind: update.kind ?? base.kind,
    status: update.status ?? base.status,
    locations: update.locations ? update.locations.map(l => l.path) : base.locations,
    content: update.content ? update.content.map(toolContent).filter(c => c !== null) : base.content,
  };
  if (index >= 0) live.setPart(index, part);
  else live.pushPart(part);
  return part;
}

function applyChunk(live: LiveRun, type: 'text' | 'thought', block: acp.ContentBlock) {
  if (block.type === 'image') {
    live.pushPart({ type: 'image', mimeType: block.mimeType, data: block.data });
    return;
  }
  const text = blockText(block);
  if (text) live.appendText(type, text);
}

// Applies an update that belongs to the active turn.
export function applyUpdate(live: LiveRun, update: acp.SessionUpdate) {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return applyChunk(live, 'text', update.content);
    case 'agent_thought_chunk':
      return applyChunk(live, 'thought', update.content);
    case 'tool_call':
    case 'tool_call_update':
      upsertTool(live, update);
      return;
    case 'plan': {
      const part: Part = { type: 'plan', entries: update.entries.map(e => ({ content: e.content, status: e.status, priority: e.priority })) };
      const index = live.parts.findIndex(p => p.type === 'plan');
      if (index >= 0) live.setPart(index, part);
      else live.pushPart(part);
      return;
    }
    // Messages exchanged with a subagent sit between the agent's own text; the text after them is a new paragraph.
    case 'session_message':
    case 'session_message_chunk':
      live.breakText();
      return;
  }
}
