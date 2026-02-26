import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import { createSignal, For, Show, Suspense, type Accessor } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import { ThreadRailDecorations } from './ThreadRailDecorations';
import { ThreadRepliesContainer } from './ThreadRepliesContainer';
import { ThreadReplyButton } from './ThreadReplyButton';
import { replyCenterOffsetX } from './thread-rail-geometry';
import type { ThreadProps } from './types';
import type { ApiThreadReply } from '@service-comms/client';
import { ThreadCollapsedIndicator } from './ThreadCollapsedIndicator';
import {
  DEFAULT_VISIBLE_REPLY_COUNT,
  getCollapsedRepliesCount,
  getThreadLatestReplyAt,
  getUniqueReplyUserIds,
} from './thread-reply-indicator-helpers';

function sliceIf<T>(
  val: Array<T>,
  start: number,
  end: number,
  should: boolean
): Array<T> {
  return should ? val.slice(start, end) : val;
}

function ThreadReplyList(props: {
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
}) {
  return (
    <For each={props.replies}>
      {(reply) => (
        <ChannelMessage
          message={reply}
          actions={props.getMessageActions?.(reply)}
        />
      )}
    </For>
  );
}

export function Thread(props: ThreadProps) {
  const [isReplying, setIsReplying] = createSignal(false);

  const thread = () => props.data().thread;
  const hasReplies = () => thread().reply_count > 0;
  const fetchRepliesEnabled = () => props.data().thread.reply_count > 0;

  const repliesQuery = useThreadRepliesQuery(
    props.channelId,
    () => props.data().id,
    fetchRepliesEnabled
  );

  const sliceIfNotExpanded =
    <T,>(val: Accessor<Array<T>>) =>
    () =>
      sliceIf(val(), 0, DEFAULT_VISIBLE_REPLY_COUNT, !props.isExpanded());

  const previewReplies = sliceIfNotExpanded(() => thread().preview ?? []);
  const fetchedReplies = sliceIfNotExpanded(() => repliesQuery.data ?? []);
  const hasFetchedReplies = () => repliesQuery.data !== undefined;
  const activeReplies = () => {
    const replies = repliesQuery.data;
    if (replies && !repliesQuery.isLoading) return replies;
    return thread().preview ?? [];
  };
  const collapsedRepliesCount = () =>
    getCollapsedRepliesCount(thread().reply_count, DEFAULT_VISIBLE_REPLY_COUNT);
  const collapsedReplyUsers = () => getUniqueReplyUserIds(activeReplies());
  const collapsedLatestReplyAt = () =>
    getThreadLatestReplyAt(thread().latest_reply_at, activeReplies());
  const shouldShowCollapsedIndicator = () =>
    !isReplying() && !props.isExpanded() && collapsedRepliesCount() > 0;
  const shouldShowReplyButton = () =>
    hasReplies() && !isReplying() && !shouldShowCollapsedIndicator();

  const expand = () => {
    props.setIsExpanded(true);
  };

  return (
    <Suspense>
      <div class="flex flex-col w-full">
        <ChannelMessage
          message={props.data()}
          actions={props.getMessageActions?.(props.data())}
        />
        <Show when={hasReplies()}>
          <div class="relative w-full">
            <ThreadRailDecorations isReplying={isReplying} />
            <ThreadRepliesContainer>
              <Show
                when={
                  fetchRepliesEnabled() &&
                  !repliesQuery.isLoading &&
                  hasFetchedReplies()
                }
                fallback={
                  <ThreadReplyList
                    replies={previewReplies()}
                    getMessageActions={props.getMessageActions}
                  />
                }
              >
                <Suspense>
                  <ThreadReplyList
                    replies={fetchedReplies()}
                    getMessageActions={props.getMessageActions}
                  />
                </Suspense>
              </Show>

              <Show
                when={shouldShowCollapsedIndicator() || shouldShowReplyButton()}
              >
                <div
                  class="relative z-10 w-fit"
                  style={{
                    'margin-left': `calc(${replyCenterOffsetX} - var(--user-icon-width) / 2)`,
                  }}
                >
                  <Show when={shouldShowCollapsedIndicator()}>
                    <ThreadCollapsedIndicator
                      collapsedRepliesCount={collapsedRepliesCount()}
                      participants={collapsedReplyUsers()}
                      latestReplyAt={collapsedLatestReplyAt()}
                      onClick={expand}
                    />
                  </Show>
                  <Show when={shouldShowReplyButton()}>
                    <ThreadReplyButton
                      onClick={() => setIsReplying(true)}
                      aria-label="Reply"
                    />
                  </Show>
                </div>
              </Show>
            </ThreadRepliesContainer>
          </div>
        </Show>
      </div>
    </Suspense>
  );
}
