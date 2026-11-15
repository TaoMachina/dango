// What an agent needs to know about Agentry in one session: who it is here and what it can do.
import type { Agent, Conversation, Project } from '../../shared/types.ts';
import type { HelperInfo } from '../helpers.ts';

const describe = (a: Agent) => `@${a.name} (${a.runtimeLabel}${a.description ? `: ${a.description}` : ''})`;

const leadOf = (conversation: Conversation, members: Agent[]) => members.find(m => m.id === (conversation.leadId ?? conversation.memberIds[0]))!;

function roleLines(conversation: Conversation, agent: Agent, members: Agent[]): string[] {
  const lead = leadOf(conversation, members);
  if (lead.id === agent.id) {
    return [
      'You are the lead. Messages without an @mention come to you. Pick who fits each part of the work: write @Name with a clear ' +
      'request to hand it to a member; you can ask several at once. They see the conversation and answer in the group. ' +
      'When everyone you asked has answered, you are asked again: check their work and give the person one clear answer. ' +
      'Do the work yourself when no member is better suited.',
    ];
  }
  return [
    `The lead is @${lead.name}. When you are asked, do your part and answer in the group; the lead is told when you finish, ` +
    'so you do not need to @mention anyone back. Write @Name only when you need another member to act.',
  ];
}

const tools =
  'With the agentry tools you can start coding work in a project with agentry_start_code_task (an existing project by name, or a folder path), ' +
  'see projects and their Code threads with agentry_list_projects, check a Code thread\'s progress and result with agentry_read_code_thread, ' +
  'and schedule work with agentry_create_routine.\n' +
  'Coding work belongs in Code, where the person follows projects, files and changes: when the person asks you to create or change ' +
  'a project, an app or files, call agentry_start_code_task (an existing project, or the folder path for a new one) instead of editing ' +
  'files here, then tell the person in one line that the work continues in Code (Agentry posts the link, so leave out ids). ' +
  'Answering questions and reading files is fine here.';

const helperText = (h: HelperInfo) => `${h.name} (${h.runtime}; model: ${h.model ?? 'its default'}; effort: ${h.effort ?? 'its default'})`;

// The helpers the person allows in this Code thread and how to delegate to them. Empty when none is enabled.
function helperLines(helpers: HelperInfo[]): string[] {
  const enabled = helpers.filter(h => h.enabled);
  if (enabled.length === 0) return [];
  return [
    `Helpers: ${enabled.map(helperText).join(', ')}. They are other coding agents on this computer that work in this same project folder. ` +
    'To hand one a part of the work, call agentry_delegate with the helper\'s name and complete instructions: it does not see this conversation. ' +
    'agentry_delegate returns the helper\'s final answer, or a delegationId while the helper is still working; then call agentry_wait_for_helper with it. ' +
    'Check a helper\'s work before you rely on it. Your own subagents work as usual.',
  ];
}

const delegatedLine = 'Another agent handed you this task through Agentry; its message starts with its name. ' +
  'Your final message is returned to that agent as the result, so end with a complete answer.';

// `project` is the code thread's project and null for chats and groups; `helpers` is empty outside Code threads.
export function sessionContext(conversation: Conversation, agent: Agent, members: Agent[], project: Project | null, helpers: HelperInfo[] = []): string {
  return contextLines(conversation, agent, members, project, tools, helpers);
}

// For agents the hub calls over an OpenAI-compatible API: they have no agentry tools, so the context leaves them out.
export function apiContext(conversation: Conversation, agent: Agent, members: Agent[], project: Project | null): string {
  return contextLines(conversation, agent, members, project, null, []);
}

function contextLines(conversation: Conversation, agent: Agent, members: Agent[], project: Project | null, toolText: string | null, helpers: HelperInfo[]): string {
  const lines = [`You are ${agent.name} in Agentry, an app where the person on this computer talks with their agents.`];
  if (conversation.kind === 'chat') {
    lines.push(toolText ? `This is your own chat with the person. ${toolText}` : 'This is your own chat with the person.');
  } else if (conversation.kind === 'group') {
    lines.push(
      `This is the group "${conversation.title}". Members: ${members.map(describe).join(', ')}.`,
      ...roleLines(conversation, agent, members),
      `Agent-to-agent handoffs stop after ${conversation.hopLimit} in a row. Group messages reach you as [Author]: text, and your reply is posted to the group.`,
      ...(toolText ? [toolText] : []),
    );
  } else {
    lines.push(`You are working in project ${project!.name} at ${project!.path}.`, ...(conversation.parentId ? [delegatedLine] : []), ...helperLines(helpers));
  }
  return lines.join('\n');
}

// Identifies the group or helper facts the context states, so a change can be announced to an existing session.
export function membershipKey(conversation: Conversation): string {
  if (conversation.kind === 'group') return `${conversation.memberIds.join(',')}|${conversation.leadId}|${conversation.hopLimit}`;
  if (conversation.kind === 'code') return JSON.stringify(conversation.helpers.filter(h => h.enabled));
  return '';
}

export function membershipUpdate(conversation: Conversation, agent: Agent, members: Agent[], helpers: HelperInfo[]): string {
  if (conversation.kind === 'code') {
    const lines = helperLines(helpers);
    return lines.length > 0 ? `Helper update: ${lines.join(' ')}` : 'Helper update: no helpers are enabled now, so agentry_delegate refuses every helper.';
  }
  return `Group update: members are now ${members.map(describe).join(', ')}. ${roleLines(conversation, agent, members).join(' ')}`;
}
