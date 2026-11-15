// What an agent needs to know about Agentry in one session: who it is here and what it can do.
import type { Agent, Conversation, Project } from '../../shared/types.ts';

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
  'and schedule work with agentry_create_routine. Do larger file edits through a Code thread rather than in a conversation.';

// `project` is the code thread's project and null for chats and groups.
export function sessionContext(conversation: Conversation, agent: Agent, members: Agent[], project: Project | null): string {
  return contextLines(conversation, agent, members, project, tools);
}

// For agents the hub calls over an OpenAI-compatible API: they have no agentry tools, so the context leaves them out.
export function apiContext(conversation: Conversation, agent: Agent, members: Agent[], project: Project | null): string {
  return contextLines(conversation, agent, members, project, null);
}

function contextLines(conversation: Conversation, agent: Agent, members: Agent[], project: Project | null, toolText: string | null): string {
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
    lines.push(`You are working in project ${project!.name} at ${project!.path}.`);
  }
  return lines.join('\n');
}

// Identifies the group facts the context states, so a change can be announced to an existing session.
export function membershipKey(conversation: Conversation): string {
  return conversation.kind === 'group' ? `${conversation.memberIds.join(',')}|${conversation.leadId}|${conversation.hopLimit}` : '';
}

export function membershipUpdate(conversation: Conversation, agent: Agent, members: Agent[]): string {
  return `Group update: members are now ${members.map(describe).join(', ')}. ${roleLines(conversation, agent, members).join(' ')}`;
}
