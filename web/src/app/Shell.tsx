import { Drawer } from '../components/Drawer.tsx';
import { ChatList } from '../chat/ChatList.tsx';
import { ChatHome } from '../chat/ChatHome.tsx';
import { CodeList } from '../code/CodeList.tsx';
import { CodeHome } from '../code/CodeHome.tsx';
import { NewThread } from '../code/NewThread.tsx';
import { ConversationView } from '../conversation/ConversationView.tsx';
import { RightPanel } from '../panels/RightPanel.tsx';
import { updateUI, useStore } from '../lib/store.ts';
import { useMedia, WIDE_LIST, WIDE_PANEL } from '../lib/media.ts';
import { Rail } from './Rail.tsx';

function Sidebar({ showList }: { showList: boolean }) {
  const module = useStore((s) => s.ui.module);
  return (
    <div className="flex h-full bg-sidebar">
      <Rail />
      {showList && <div className="flex h-full w-[300px] max-w-[calc(88vw-60px)] flex-col">{module === 'chat' ? <ChatList /> : <CodeList />}</div>}
    </div>
  );
}

function Center() {
  const ui = useStore((s) => s.ui);
  const conversations = useStore((s) => s.conversations);
  const id = ui.selected[ui.module];
  const conversation = id ? conversations[id] : undefined;
  if (ui.module === 'code' && ui.newThreadProjectId) return <NewThread key={ui.newThreadProjectId} projectId={ui.newThreadProjectId} />;
  if (conversation && (ui.module === 'code') === (conversation.kind === 'code')) return <ConversationView key={conversation.id} conversation={conversation} />;
  return ui.module === 'chat' ? <ChatHome /> : <CodeHome />;
}

export function Shell() {
  const ui = useStore((s) => s.ui);
  const conversations = useStore((s) => s.conversations);
  const wideList = useMedia(WIDE_LIST);
  const widePanel = useMedia(WIDE_PANEL);
  const id = ui.selected[ui.module];
  const conversation = id && !(ui.module === 'code' && ui.newThreadProjectId) ? conversations[id] : undefined;
  const closeDrawer = () => updateUI({ drawer: null });

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      {wideList ? (
        <aside className="h-full shrink-0 border-r border-line">
          <Sidebar showList={!ui.listCollapsed} />
        </aside>
      ) : (
        ui.drawer === 'list' && (
          <Drawer side="left" label="Navigation" onClose={closeDrawer}>
            <Sidebar showList />
          </Drawer>
        )
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <Center />
      </main>
      {conversation &&
        (widePanel ? (
          ui.panelOpen && (
            <aside className="h-full w-[320px] shrink-0 overflow-y-auto border-l border-line">
              <RightPanel conversation={conversation} />
            </aside>
          )
        ) : (
          ui.drawer === 'panel' && (
            <Drawer side="right" label="Details" onClose={closeDrawer}>
              <div className="h-full w-[320px] max-w-[88vw] overflow-y-auto">
                <RightPanel conversation={conversation} />
              </div>
            </Drawer>
          )
        ))}
    </div>
  );
}
