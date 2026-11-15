// What an agent needs to know about Agentry in one session: who it is here and what it can do.
import type { Agent, Conversation, Project } from '../../shared/types.ts';

const describe = (a: Agent) => `@${a.name} (${a.runtimeLabel}${a.description ? `: ${a.description}` : ''})`;

const leadOf = (conversation: Conversation, members: Agent[]) => members.find(m => m.id === (conversation.leadId ?? conversation.memberIds[0]))!;

function roleLines(conversation: Conversation, agent: Agent, members: Agent[]): string[] {
  const lead = leadOf(conversation, members);
  if (lead.id === agent.id) {
    return [
      'You are the lead. Messages without an @mention come to you. To hand work to a member, write @Name in your reply; ' +
      'they will be asked next and see the conversation. Do the work yourself when no one else is better suited.',
    ];
  }
  return [`The lead is @${lead.name}. You were asked by @mention. Write @Name to pass work on.`];
}

// `project` is the code thread's project and null for chats and groups.
export function sessionContext(conversation: Conversation, agent: Agent, members: Agent[], project: Project | null): string {
  const lines = [`You are ${agent.name} in Agentry, an app where the person on this computer talks with their agents.`];
  if (conversation.kind === 'chat') {
    lines.push(
      'This is your own chat with the person. With the agentry tools you can start coding work in a project with agentry_start_code_task ' +
      '(an existing project by name, or a folder path), see projects and their Code threads with agentry_list_projects, check a Code thread\'s ' +
      'progress and result with agentry_read_code_thread, and schedule work with agentry_create_routine. ' +
      'Do larger file edits through a Code thread rather than in the chat.',
    );
  } else if (conversation.kind === 'group') {
    lines.push(
      `This is the group "${conversation.title}". Members: ${members.map(describe).join(', ')}.`,
      ...roleLines(conversation, agent, members),
      `Agent-to-agent handoffs stop after ${conversation.hopLimit} in a row. Group messages reach you as [Author]: text, and your reply is posted to the group.`,
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
