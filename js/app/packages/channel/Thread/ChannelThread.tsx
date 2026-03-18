import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import {
  createEffect,
  createSignal,
  on,
  Show,
  Suspense,
  type Accessor,
} from 'solid-js';
import { ChannelMessage } from '../Message';
import { MarkMessaageNotifications } from '@notifications/components/MarkMessageNotifications';
import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { Thread } from './Thread';
import type { ThreadProps } from './types';
import type { ApiThreadReply } from '@service-comms/client';
import type { ThreadReplyListHandle } from './ThreadReplyList';
import {
  DEFAULT_VISIBLE_REPLY_COUNT,
  getCollapsedRepliesCount,
  getThreadLatestReplyAt,
  getUniqueReplyUserIds,
} from './utils/thread-reply-indicator-helpers';
import { createMessageSelection } from '../Channel/create-message-selection';
import { createThreadHotkeys } from './create-thread-hotkeys';

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

  const isSelected = () => props.selectedMessageId?.() === props.data().id;

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

  // Thread-local reply selection
  const replySelection = createMessageSelection({
    keys: () => activeReplies().map((r) => r.id),
  });

  const isThreadFocused = () => isSelected() && !!replySelection.selectedId();

  const { attachReplyInputRef } = createThreadHotkeys({
    messageListScopeId: props.messageListScopeId!,
    replySelection,
    isThreadFocused,
    activeReplies,
    threadId: () => props.data().id,
    getMessageActions: (msg) => props.getMessageActions?.(msg),
    userId,
    parentMessage: props.data,
    collapseThread: () => props.setIsExpanded(false),
    isSelected,
    hasReplies,
    expandThread: () => props.setIsExpanded(true),
    isThreadExpanded: props.isExpanded,
    setIsReplying: (v) => props.setIsReplying(v),
  });

  const firstReplyIsNewMessage = () => {
    const first = activeReplies()[0];
    return first ? props.isNewMessage?.(first) : false;
  };
  const collapsedRepliesCount = () =>
    getCollapsedRepliesCount(thread().reply_count, DEFAULT_VISIBLE_REPLY_COUNT);
  const collapsedRepliesContainsNewMessages = () =>
    activeReplies()
      .slice(DEFAULT_VISIBLE_REPLY_COUNT)
      .some((reply: ApiThreadReply) => props.isNewMessage?.(reply));
  const collapsedReplyUsers = () => getUniqueReplyUserIds(activeReplies());
  const collapsedLatestReplyAt = () =>
    getThreadLatestReplyAt(thread().latest_reply_at, activeReplies());
  const shouldShowCollapsedIndicator = () =>
    !props.isReplying() && !props.isExpanded() && collapsedRepliesCount() > 0;
  const shouldShowReplyButton = () =>
    hasReplies() && !props.isReplying() && !shouldShowCollapsedIndicator();
  const [replyListHandle, setReplyListHandle] =
    createSignal<ThreadReplyListHandle>();

  const expand = () => {
    props.setIsExpanded(true);
  };

  createEffect(
    on(
      [
        () => props.targetReplyId,
        activeReplies,
        props.isExpanded,
        replyListHandle,
      ],
      ([targetReplyId, replies, isExpanded, handle]) => {
        if (!targetReplyId) return;

        const targetReplyIndex = replies.findIndex(
          (reply) => reply.id === targetReplyId
        );
        if (targetReplyIndex === -1) return;

        if (!isExpanded && targetReplyIndex >= DEFAULT_VISIBLE_REPLY_COUNT) {
          props.setIsExpanded(true);
          return;
        }

        handle?.scrollToIndex(targetReplyIndex);
      }
    )
  );

  return (
    <Suspense>
      <Thread.Row
        message={props.data()}
        listMeta={props.listMeta}
        onDismissNewMessages={props.threadActions?.onDismissNewMessages}
      >
        <div class="flex flex-col w-full">
          <MarkMessaageNotifications
            messageId={props.data().id}
            channelId={props.channelId()}
          >
            <ChannelMessage
              channelId={props.channelId()}
              message={props.data()}
              actions={props.getMessageActions?.(props.data())}
              listMeta={props.listMeta}
              messageEditor={props.messageEditor}
              highlighted={
                props.highlighted || (isSelected() && !isThreadFocused())
              }
              selectionState={
                isSelected() && !isThreadFocused()
                  ? { isSelected: true }
                  : undefined
              }
            />
          </MarkMessaageNotifications>
          <Show when={hasReplies() || props.isReplying()}>
            <div class="relative w-full">
              <Thread.ReplyRailDecorations
                isReplying={props.isReplying}
                firstThreadReplyNewMessage={firstReplyIsNewMessage()}
              />
              <Suspense>
                <Thread.RepliesContainer>
                  <Show
                    when={!repliesQuery.isLoading && hasFetchedReplies()}
                    fallback={
                      <Thread.ReplyList
                        channelId={props.channelId()}
                        threadId={props.data().id}
                        replies={previewReplies()}
                        getMessageActions={props.getMessageActions}
                        messageEditor={props.messageEditor}
                        isNewMessage={props.isNewMessage}
                        highlightedReplyId={props.targetReplyId}
                        onReady={setReplyListHandle}
                        selectedReplyId={replySelection.selectedId}
                        isThreadFocused={isThreadFocused}
                      />
                    }
                  >
                    <Suspense>
                      <Thread.ReplyList
                        channelId={props.channelId()}
                        threadId={props.data().id}
                        replies={fetchedReplies()}
                        getMessageActions={props.getMessageActions}
                        messageEditor={props.messageEditor}
                        isNewMessage={props.isNewMessage}
                        highlightedReplyId={props.targetReplyId}
                        onReady={setReplyListHandle}
                        selectedReplyId={replySelection.selectedId}
                        isThreadFocused={isThreadFocused}
                      />
                    </Suspense>
                  </Show>

                  <Show when={props.isReplying()}>
                    <div ref={attachReplyInputRef}>
                      <Show when={!hasReplies()}>
                        <Thread.ReplyAuthor
                          userId={replyUserId()}
                          displayName={displayName()}
                        />
                      </Show>
                      <Thread.ReplyInput
                        channelId={props.channelId()}
                        messageId={props.data().id}
                        replyInputState={props.replyInputState}
                        setReplyInputState={props.setReplyInputState}
                        setIsReplying={props.setIsReplying}
                      />
                    </div>
                  </Show>

                  <Show
                    when={
                      shouldShowCollapsedIndicator() || shouldShowReplyButton()
                    }
                  >
                    <Thread.ActionsFooter>
                      <Show when={shouldShowCollapsedIndicator()}>
                        <Thread.CollapsedIndicator
                          collapsedRepliesCount={collapsedRepliesCount()}
                          participants={collapsedReplyUsers()}
                          latestReplyAt={collapsedLatestReplyAt()}
                          onClick={expand}
                          hasNewMessages={collapsedRepliesContainsNewMessages()}
                        />
                      </Show>
                      <Show when={shouldShowReplyButton()}>
                        <Thread.ReplyButton
                          onClick={() => props.setIsReplying(true)}
                          aria-label="Reply"
                        />
                      </Show>
                    </Thread.ActionsFooter>
                  </Show>
                </Thread.RepliesContainer>
              </Suspense>
            </div>
          </Show>
        </div>
      </Thread.Row>
    </Suspense>
  );
}
