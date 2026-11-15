import type { Agent, AgentStatus, Avatar, Conversation, ID } from '../../../shared/types.ts';
import { defaultAvatar } from '../components/Avatar.tsx';

/** The agent a chat or code thread talks to. */
export function primaryAgent(conversation: Conversation, agents: Record<ID, Agent>): Agent | undefined {
  return conversation.kind === 'group' ? undefined : agents[conversation.memberIds[0]];
}

export function conversationTitle(conversation: Conversation, agents: Record<ID, Agent>) {
  return conversation.kind === 'chat' ? (agents[conversation.memberIds[0]]?.name ?? conversation.title) : conversation.title;
}

export function conversationAvatar(conversation: Conversation, agents: Record<ID, Agent>): Avatar {
  const agent = primaryAgent(conversation, agents);
  if (agent) return agent.avatar;
  return conversation.avatar ?? defaultAvatar(conversation.id);
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  available: 'Available',
  starting: 'Starting',
  ready: 'Ready',
  working: 'Working',
  'needs-auth': 'Needs sign-in',
  error: 'Error',
  offline: 'Offline',
};

export const STATUS_COLOR: Record<AgentStatus, string> = {
  available: 'bg-faint',
  starting: 'bg-warn',
  ready: 'bg-success',
  working: 'bg-success',
  'needs-auth': 'bg-warn',
  error: 'bg-danger',
  offline: 'bg-faint',
};
