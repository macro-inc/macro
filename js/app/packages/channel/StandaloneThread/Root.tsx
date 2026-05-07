import { DebugSuspense } from '@channel/DebugSuspense';
import { useChannelMessagesByIdsQuery } from '@queries/channel/channel-messages';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import type { ApiChannelMessage, ApiThreadReply } from '@service-comms/client';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { ThreadRail } from '../Thread/ThreadRail';
import { DEFAULT_VISIBLE_REPLY_COUNT } from '../Thread/utils/thread-reply-indicator-helpers';
import { StandaloneThreadContext } from './context';

type RootProps = ParentProps<{
  channelId: string;
  messageId: string;
  data?: ApiChannelMessage;
}>;

export function Root(props: RootProps) {
  return (
    <DebugSuspense name="StandaloneThread.Root">
      <RootInner {...props} />
    </DebugSuspense>
  );
}

function RootInner(props: RootProps) {
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [isReplying, setIsReplying] = createSignal(false);

  const parentQuery = useChannelMessagesByIdsQuery(
    () => props.channelId,
    () => (props.data ? [] : [props.messageId])
  );

  const parent = () => props.data ?? parentQuery.data?.[0];
  const hasThread = () => (parent()?.thread.reply_count ?? 0) > 0;

  const repliesQuery = useThreadRepliesQuery(
    () => props.channelId,
    () => props.messageId,
    () => hasThread() || isReplying()
  );

  const replies = (): ApiThreadReply[] =>
    repliesQuery.data ?? parent()?.thread.preview ?? [];

  const hasReplies = () => replies().length > 0;

  const displayReplies = (): ApiThreadReply[] => {
    const all = replies();
    if (isExpanded()) return all;
    return all.slice(0, DEFAULT_VISIBLE_REPLY_COUNT);
  };

  return (
    <StandaloneThreadContext.Provider
      value={{
        channelId: () => props.channelId,
        messageId: () => props.messageId,
        parent,
        replies,
        displayReplies,
        hasReplies,
        isExpanded,
        setIsExpanded,
        isReplying,
        setIsReplying,
      }}
    >
      <div class="relative">
        <Show when={hasReplies() || isReplying()}>
          <ThreadRail />
        </Show>
        {props.children}
      </div>
    </StandaloneThreadContext.Provider>
  );
}
