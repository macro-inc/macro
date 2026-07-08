import { DebugSuspense } from '@channel/DebugSuspense';
import { useChannelMessagesByIdsQuery } from '@queries/channel/channel-messages';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { ApiThreadReply } from '@service-storage/generated/schemas/apiThreadReply';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { createFocusRequest } from '../Thread/focus-request';
import { ThreadRail } from '../Thread/ThreadRail';
import { DEFAULT_VISIBLE_REPLY_COUNT } from '../Thread/utils/thread-reply-indicator-helpers';
import { StandaloneThreadContext } from './context';

type RootProps = ParentProps<{
  channelId: string;
  messageId: string;
  data?: ApiChannelMessage;
  unreadMessageIds?: string[];
  fallback?: JSX.Element;
  errorFallback?: (retry: () => void) => JSX.Element;
}>;

export function Root(props: RootProps) {
  return (
    <DebugSuspense name="StandaloneThread.Root" fallback={props.fallback}>
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

  const unreadMessageIds = createMemo(
    () => new Set(props.unreadMessageIds ?? [])
  );

  // Window the visible replies so the first unread reply is always shown,
  // while keeping at least the default count when the thread is short.
  const unreadWindowStart = createMemo(() => {
    const ids = unreadMessageIds();
    if (ids.size === 0) return -1;
    const all = replies();
    const firstUnread = all.findIndex((reply) => ids.has(reply.id));
    if (firstUnread < 0) return -1;
    return Math.min(
      firstUnread,
      Math.max(0, all.length - DEFAULT_VISIBLE_REPLY_COUNT)
    );
  });

  const displayReplies = (): ApiThreadReply[] => {
    const all = replies();
    if (isExpanded()) return all;
    const windowStart = unreadWindowStart();
    if (windowStart >= 0) return all.slice(windowStart);
    return all.slice(0, DEFAULT_VISIBLE_REPLY_COUNT);
  };

  const hiddenEarlierReplyCount = () =>
    isExpanded() ? 0 : Math.max(unreadWindowStart(), 0);

  const showLoadingFallback = () =>
    props.fallback !== undefined &&
    !parent() &&
    (parentQuery.isPending || parentQuery.isFetching);

  const showErrorFallback = () =>
    props.errorFallback !== undefined && !parent() && parentQuery.isError;

  return (
    <StandaloneThreadContext.Provider
      value={{
        channelId: () => props.channelId,
        messageId: () => props.messageId,
        parent,
        replies,
        displayReplies,
        unreadMessageIds,
        hiddenEarlierReplyCount,
        hasReplies,
        isExpanded,
        setIsExpanded,
        isReplying,
        setIsReplying,
        replyInputFocusRequest,
      }}
    >
      <Switch
        fallback={
          <div class="relative">
            <Show when={hasReplies() || isReplying()}>
              <ThreadRail />
            </Show>
            {props.children}
          </div>
        }
      >
        <Match when={showLoadingFallback()}>{props.fallback}</Match>
        <Match when={showErrorFallback()}>
          {props.errorFallback?.(() => void parentQuery.refetch())}
        </Match>
      </Switch>
    </StandaloneThreadContext.Provider>
  );
}
