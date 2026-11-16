import { ArrowLeft } from 'lucide-react';
import type { Conversation } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { IconButton } from '../components/ui.tsx';
import { Composer } from '../conversation/Composer.tsx';
import { useAgentSession } from '../conversation/ConversationView.tsx';
import { MessageList } from '../conversation/MessageList.tsx';
import { closeSideThread } from '../lib/actions.ts';
import { conversationAvatar, conversationTitle } from '../lib/display.ts';
import { useMedia, WIDE_PANEL } from '../lib/media.ts';
import { useStore } from '../lib/store.ts';

/** A helper's thread in the right panel: its work, its permission cards and a composer to talk to it. */
export function SideThread({ conversation }: { conversation: Conversation }) {
  const agents = useStore((s) => s.agents);
  const wide = useMedia(WIDE_PANEL);
  useAgentSession(conversation);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <IconButton label="Back" onClick={() => closeSideThread(wide)}>
          <ArrowLeft size={18} />
        </IconButton>
        <Avatar avatar={conversationAvatar(conversation, agents)} size={22} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{conversationTitle(conversation, agents)}</span>
      </header>
      <MessageList conversation={conversation} />
      <Composer conversation={conversation} />
    </div>
  );
}
