import { DebugSuspense } from '@channel/DebugSuspense';
import { useThreadRepliesQuery } from '@queries/messages/thread-replies';
import { useMessageTimelineByIdsQuery } from '@queries/messages/timeline';
import type {
  Message as EntityMessage,
  MessageListItem,
} from '@service-storage/messages';
import { createSignal, type ParentProps } from 'solid-js';
import { createFocusRequest } from '../Thread/focus-request';
import { DEFAULT_VISIBLE_REPLY_COUNT } from '../Thread/utils/thread-reply-indicator-helpers';
import { StandaloneThreadContext } from './context';

type RootProps = ParentProps<{
  channelId: string;
  messageId: string;
  data?: MessageListItem;
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

  const parentQuery = useMessageTimelineByIdsQuery(
    () => ({ type: 'channel', id: (() => props.channelId)() }),
    () => (props.data ? [] : [props.messageId])
  );

  const parent = () => props.data ?? parentQuery.data?.[0];
  const hasThread = () => (parent()?.thread.reply_count ?? 0) > 0;

  const repliesQuery = useThreadRepliesQuery(
    () => ({ type: 'channel', id: (() => props.channelId)() }),
    () => props.messageId,
    () => hasThread() || isReplying()
  );

  const replies = (): EntityMessage[] =>
    repliesQuery.data ?? parent()?.thread.preview ?? [];

  const hasReplies = () => replies().length > 0;

  const displayReplies = (): EntityMessage[] => {
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
