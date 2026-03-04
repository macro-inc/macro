import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import { Show, Suspense, type Accessor } from 'solid-js';
import { ChannelMessage } from '../Message';
import { ChannelInput } from '../Input';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { Thread } from './Thread';
import {
  replyCenterOffsetX,
  replyInputOffsetX,
} from './thread-rail-geometry';
import type { ThreadProps } from './types';
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

export function ChannelThread(props: ThreadProps) {
  const userId = useUserId();
  const replyUserId = () => userId() ?? props.data().sender_id;
  const macroId = () => tryMacroId(replyUserId());
  const [displayName] = useDisplayName(macroId());
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
    !props.isReplying() && !props.isExpanded() && collapsedRepliesCount() > 0;
  const shouldShowReplyButton = () =>
    hasReplies() && !props.isReplying() && !shouldShowCollapsedIndicator();

  const expand = () => {
    props.setIsExpanded(true);
  };

  return (
    <Suspense>
      <Thread.Row
        message={props.data()}
        listMeta={props.listMeta}
        onDismissNewMessages={props.threadActions?.onDismissNewMessages}
      >
        <div class="flex flex-col w-full">
          <ChannelMessage
            message={props.data()}
            actions={props.getMessageActions?.(props.data())}
          />
          <Show when={hasReplies() || props.isReplying()}>
            <div class="relative w-full">
              <Thread.RailDecorations isReplying={props.isReplying} />
              <Thread.RepliesContainer>
                <Show
                  when={
                    fetchRepliesEnabled() &&
                    !repliesQuery.isLoading &&
                    hasFetchedReplies()
                  }
                  fallback={
                    <Thread.ReplyList
                      replies={previewReplies()}
                      getMessageActions={props.getMessageActions}
                    />
                  }
                >
                  <Suspense>
                    <Thread.ReplyList
                      replies={fetchedReplies()}
                      getMessageActions={props.getMessageActions}
                    />
                  </Suspense>
                </Show>

                <Show when={props.isReplying()}>
                  <Show
                    when={hasReplies()}
                    fallback={
                      <>
                        <div class="flex items-start gap-2 p-2">
                          <div class="flex-shrink-0 size-[var(--user-icon-width)]">
                            <UserIcon id={replyUserId()} size="fill" />
                          </div>
                          <span class="text-sm font-semibold truncate mt-1">
                            {displayName()}
                          </span>
                        </div>
                        <div
                          class="relative"
                          style={{
                            'margin-left': replyInputOffsetX,
                          }}
                        >
                          <Thread.ReplyInputConnector />
                          <ChannelInput
                            input={{
                              id: `thread-reply-input-${props.data().id}`,
                              placeholder: 'Send a reply',
                              value: props.replyInputState()?.value,
                              attachments:
                                props.replyInputState()?.attachments,
                              isReplyInput: true,
                            }}
                            markdownNamespace={`thread-reply-input-${props.data().id}-markdown`}
                            onChange={(snapshot) =>
                              void props.setReplyInputState(snapshot)
                            }
                            onCloseDraft={() => {
                              props.setReplyInputState(undefined);
                              props.setIsReplying(false);
                            }}
                            onSend={async () => {
                              props.setReplyInputState(undefined);
                              props.setIsReplying(false);
                            }}
                          />
                        </div>
                      </>
                    }
                  >
                    <div
                      class="relative"
                      style={{
                        'margin-left': replyInputOffsetX,
                      }}
                    >
                      <Thread.ReplyInputConnector />
                      <ChannelInput
                        input={{
                          id: `thread-reply-input-${props.data().id}`,
                          placeholder: 'Send a reply',
                          value: props.replyInputState()?.value,
                          attachments: props.replyInputState()?.attachments,
                          isReplyInput: true,
                        }}
                        markdownNamespace={`thread-reply-input-${props.data().id}-markdown`}
                        onChange={(snapshot) =>
                          void props.setReplyInputState(snapshot)
                        }
                        onCloseDraft={() => {
                          props.setReplyInputState(undefined);
                          props.setIsReplying(false);
                        }}
                        onSend={async () => {
                          props.setReplyInputState(undefined);
                          props.setIsReplying(false);
                        }}
                      />
                    </div>
                  </Show>
                </Show>

                <Show
                  when={
                    shouldShowCollapsedIndicator() || shouldShowReplyButton()
                  }
                >
                  <div
                    class="relative z-10 w-fit"
                    style={{
                      'margin-left': `calc(${replyCenterOffsetX} - var(--user-icon-width) / 2)`,
                    }}
                  >
                    <Show when={shouldShowCollapsedIndicator()}>
                      <Thread.CollapsedIndicator
                        collapsedRepliesCount={collapsedRepliesCount()}
                        participants={collapsedReplyUsers()}
                        latestReplyAt={collapsedLatestReplyAt()}
                        onClick={expand}
                      />
                    </Show>
                    <Show when={shouldShowReplyButton()}>
                      <Thread.ReplyButton
                        onClick={() => props.setIsReplying(true)}
                        aria-label="Reply"
                      />
                    </Show>
                  </div>
                </Show>
              </Thread.RepliesContainer>
            </div>
          </Show>
        </div>
      </Thread.Row>
    </Suspense>
  );
}
