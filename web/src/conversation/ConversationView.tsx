import { useEffect } from 'react';
import { PanelRight } from 'lucide-react';
import type { Conversation } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { EditableText } from '../components/EditableText.tsx';
import { MenuToggle } from '../components/MenuToggle.tsx';
import { IconButton } from '../components/ui.tsx';
import { openSession, patchAgent, patchConversation, togglePanel } from '../lib/actions.ts';
import { conversationAvatar, conversationTitle, primaryAgent } from '../lib/display.ts';
import { useMedia, WIDE_PANEL } from '../lib/media.ts';
import { useStore } from '../lib/store.ts';
import { Composer } from './Composer.tsx';
import { MessageList } from './MessageList.tsx';

function Header({ conversation }: { conversation: Conversation }) {
  const agents = useStore((s) => s.agents);
  const project = useStore((s) => (conversation.projectId ? s.projects[conversation.projectId] : undefined));
  const panelOpen = useStore((s) => s.ui.panelOpen || s.ui.side !== null);
  const widePanel = useMedia(WIDE_PANEL);
  const agent = primaryAgent(conversation, agents);
  const title = conversationTitle(conversation, agents);
  const problem = agent && (agent.status === 'needs-auth' || agent.status === 'error') ? agent.statusDetail : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
      <MenuToggle />
      <Avatar avatar={conversationAvatar(conversation, agents)} size={26} />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex min-w-0 items-baseline gap-2">
          <EditableText
            value={title}
            label={conversation.kind === 'chat' ? 'Agent name' : 'Title'}
            className="text-[15px] font-semibold"
            onSave={(value) => void (conversation.kind === 'chat' && agent ? patchAgent(agent.id, { name: value }) : patchConversation(conversation.id, { title: value }))}
          />
          {project && <span className="truncate text-[13px] text-muted">{project.name}</span>}
        </div>
        {problem && <p className="truncate px-1 text-[12px] text-warn">{problem}</p>}
      </div>
      <IconButton label="Details" active={widePanel && panelOpen} onClick={() => togglePanel(widePanel)}>
        <PanelRight size={18} />
      </IconButton>
    </header>
  );
}

/** Opens the agent's session so the composer shows its models and options. */
export function useAgentSession(conversation: Conversation) {
  const agentId = conversation.kind === 'group' ? null : conversation.memberIds[0];
  useEffect(() => {
    if (agentId) void openSession(conversation.id, agentId);
  }, [conversation.id, agentId]);
}

export function ConversationView({ conversation }: { conversation: Conversation }) {
  useAgentSession(conversation);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header conversation={conversation} />
      <MessageList conversation={conversation} />
      <Composer conversation={conversation} />
    </div>
  );
}
