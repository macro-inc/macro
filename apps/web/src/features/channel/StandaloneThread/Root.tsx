import { DebugSuspense } from '@channel/DebugSuspense';
import { useChannelMessagesByIdsQuery } from '@queries/channel/channel-messages';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { ApiThreadReply } from '@service-storage/generated/schemas/apiThreadReply';
import { createSignal, type ParentProps } from 'solid-js';
import { createFocusRequest } from '../Thread/focus-request';
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
  const replyInputFocusRequest = createFocusRequest();

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
        replyInputFocusRequest,
      }}
    >
      <div class="relative isolate z-0">{props.children}</div>
    </StandaloneThreadContext.Provider>
  );
}
