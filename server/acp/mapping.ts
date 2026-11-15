// Maps ACP session updates onto Rea message parts and session settings.
import type * as acp from '@agentclientprotocol/sdk';
import type { ID, Part, SessionInfo, SessionOption, ToolContent } from '../../shared/types.ts';
import type { LiveRun } from '../routing.ts';

export interface SessionState {
  configOptions: acp.SessionConfigOption[];
  // Agents without a "mode" config option may still report the older session modes.
  modes: acp.SessionModeState | null;
  commands: { name: string; description: string }[];
}

// The id under which session modes appear when the agent reports them only as `modes`.
export const LEGACY_MODE_ID = 'acp:mode';

export function stateFrom(response: { modes?: acp.SessionModeState | null; configOptions?: acp.SessionConfigOption[] | null }): SessionState {
  return { configOptions: response.configOptions ?? [], modes: response.modes ?? null, commands: [] };
}

function optionFrom(o: acp.SessionConfigOption): SessionOption {
  const common = { id: o.id, name: o.name, description: o.description ?? null, category: o.category ?? null };
  if (o.type === 'boolean') return { ...common, type: 'boolean', currentValue: o.currentValue };
  const choices = o.options.flatMap(c => ('group' in c ? c.options : [c])).map(c => ({ value: c.value, name: c.name, description: c.description ?? null }));
  return { ...common, type: 'select', currentValue: o.currentValue, choices };
}

// The contract asks for the model first, then the mode, then the rest in the agent's order.
const CATEGORY_ORDER = ['model', 'mode'];

export function sessionInfo(conversationId: ID, agentId: ID, state: SessionState): SessionInfo {
  const options = state.configOptions.map(optionFrom);
  if (state.modes && !options.some(o => o.category === 'mode')) {
    options.push({
      id: LEGACY_MODE_ID, name: 'Mode', description: null, category: 'mode', type: 'select', currentValue: state.modes.currentModeId,
      choices: state.modes.availableModes.map(m => ({ value: m.id, name: m.name, description: m.description ?? null })),
    });
  }
  const rank = (o: SessionOption) => {
    const i = CATEGORY_ORDER.indexOf(o.category ?? '');
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  options.sort((a, b) => rank(a) - rank(b));
  return { conversationId, agentId, options, commands: state.commands };
}

function blockText(block: acp.ContentBlock): string | null {
  if (block.type === 'text') return block.text;
  if (block.type === 'resource_link') return `[${block.title ?? block.name}](${block.uri})`;
  if (block.type === 'resource' && 'text' in block.resource) return block.resource.text;
  return null;
}

function toolContent(content: acp.ToolCallContent): ToolContent | null {
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
  }
}
