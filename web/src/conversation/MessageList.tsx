import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Conversation, Message } from '../../../shared/types.ts';
import { Button, Spinner } from '../components/ui.tsx';
import { loadEarlier, openThread } from '../lib/actions.ts';
import { useStore } from '../lib/store.ts';
import { CodeTimeline } from '../code/CodeTimeline.tsx';
import { MessageItem } from './MessageItem.tsx';

// Within this distance of the bottom (about three lines of text) the list follows new output.
const NEAR_BOTTOM = 80;

function agentOf(message: Message) {
  return message.author.type === 'agent' ? message.author.agentId : null;
}

export function MessageList({ conversation }: { conversation: Conversation }) {
  const thread = useStore((s) => s.threads[conversation.id]);
  const agents = useStore((s) => s.agents);
  const project = useStore((s) => (conversation.projectId ? s.projects[conversation.projectId] : undefined));
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const prependFrom = useRef<number | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loaded = thread !== undefined;

  useEffect(() => {
    if (!loaded) void openThread(conversation.id);
  }, [loaded, conversation.id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prependFrom.current !== null) {
      el.scrollTop += el.scrollHeight - prependFrom.current;
      prependFrom.current = null;
    } else if (following.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [thread?.messages]);

  if (!thread) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        <Spinner size={18} />
      </div>
    );
  }

  const group = conversation.kind === 'group';
  const messages = thread.messages;

  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col px-4 pb-4 pt-2 md:px-6">
        {thread.hasMore && (
          <Button
            variant="ghost"
            className="mx-auto mb-2 h-8 text-[13px] text-muted"
            disabled={loadingEarlier}
            onClick={() => {
              setLoadingEarlier(true);
              prependFrom.current = ref.current!.scrollHeight;
              // A failed load (its reason shows as a toast) adds nothing, so the next layout must not shift.
              void loadEarlier(conversation.id)
                .catch(() => (prependFrom.current = null))
                .finally(() => setLoadingEarlier(false));
            }}
          >
            {loadingEarlier && <Spinner />} Load earlier
          </Button>
        )}
        {messages.length === 0 && <p className="mt-16 text-center text-[14px] text-muted">No messages yet</p>}
        {conversation.kind === 'code' ? (
          // Code threads read as a work log, not as chat bubbles.
          <CodeTimeline
            messages={messages}
            runs={thread.runs}
            context={{ catalogId: agents[conversation.memberIds[0]]?.catalogId ?? null, root: project?.path }}
          />
        ) : (
          messages.map((message, index) => {
            const agentId = agentOf(message);
            const prev = messages[index - 1];
            const run = message.runId ? thread.runs[message.runId] : undefined;
            const parent = run?.parentRunId ? thread.runs[run.parentRunId] : undefined;
            const showHeader = group && agentId !== null && (!prev || agentOf(prev) !== agentId);
            return (
              <MessageItem
                key={message.id}
                message={message}
                agent={agentId ? agents[agentId] : undefined}
                showHeader={showHeader}
                triggeredBy={parent ? (agents[parent.agentId]?.name ?? null) : null}
                run={run}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
