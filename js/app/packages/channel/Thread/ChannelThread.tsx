import { DebugSuspense } from '@channel/DebugSuspense';
import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { MarkMessageNotifications } from '@notifications/components/MarkMessageNotifications';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import type { ApiThreadReply } from '@service-comms/client';
import { createEffect, createSignal, on, Show, untrack } from 'solid-js';
import { createMessageSelection } from '../Channel/create-message-selection';
import { ChannelMessage } from '../Message';
import { createThreadHotkeys } from './create-thread-hotkeys';
import { Thread } from './Thread';
import type { ThreadReplyListHandle } from './ThreadReplyList';
import { ThreadTypingIndicator } from './ThreadTypingIndicator';
import type { ThreadProps } from './types';
import {
  DEFAULT_VISIBLE_REPLY_COUNT,
  getCollapsedRepliesCount,
  getThreadLatestReplyAt,
  getUniqueReplyUserIds,
} from './utils/thread-reply-indicator-helpers';

export function ChannelThread(props: ThreadProps) {
  const userId = useUserId();
  const replyUserId = () => userId() ?? props.data().sender_id;
  const macroId = () => tryMacroId(replyUserId());
  const [displayName] = useDisplayName(macroId());
  const thread = () => props.data().thread;
  const hasReplies = () => thread().reply_count > 0;
  const fetchRepliesEnabled = () =>
    (!!props.targetReplyId && props.targetThreadId === props.data().id) ||
    props.isExpanded() ||
    (hasReplies() && thread().reply_count > DEFAULT_VISIBLE_REPLY_COUNT);

  const isSelected = () => props.selectedMessageId?.() === props.data().id;

  const repliesQuery = useThreadRepliesQuery(
    props.channelId,
    () => props.data().id,
    fetchRepliesEnabled
  );

  const queryReplies = (): Array<ApiThreadReply> | undefined => {
    if (repliesQuery.isLoading) return undefined;
    return repliesQuery.data;
  };

  const loadedReplies = () => queryReplies() ?? [];
  const canScrollToTargetReply = () => queryReplies() !== undefined;

  const activeReplies = (): Array<ApiThreadReply> => {
    return queryReplies() ?? thread().preview ?? [];
  };

  const displayReplies = (): Array<ApiThreadReply> => {
    const preview = thread().preview ?? [];
    // When collapsed, use preview directly without reading query state.
    if (!props.isExpanded()) {
      return preview.length > DEFAULT_VISIBLE_REPLY_COUNT
        ? preview.slice(0, DEFAULT_VISIBLE_REPLY_COUNT)
        : preview;
    }

    // When expanded, prefer fetched data (full reply list).
    const fetched = queryReplies();
    if (fetched) return fetched;
    return preview;
  };

  // Thread-local reply selection
  const replySelection = createMessageSelection({
    keys: () => activeReplies().map((r) => r.id),
  });

  // Clears the local reply selection when the channel-level selection moves away
  createEffect(
    on(
      () => props.selectedMessageId?.(),
      (selectedId) => {
        if (selectedId === props.data().id) return;
        if (replySelection.selectedId()) replySelection.clear();
      },
      { defer: true }
    )
  );

  const isThreadFocused = () => !!replySelection.selectedId();
  const selectThreadMessage = () => {
    if (isSelected() && !isThreadFocused()) {
      props.onClearSelection?.();
      return;
    }

    props.onSelectMessage?.(props.data().id);
    replySelection.clear();
  };

  const selectReply = (replyId: string) => {
    if (isSelected() && replySelection.selectedId() === replyId) {
      replySelection.clear();
      props.onClearSelection?.();
      return;
    }

    props.onSelectMessage?.(props.data().id);
    replySelection.select(replyId);
  };

  let replyInputContainerRef: HTMLDivElement | undefined;

  const { attachReplyInputRef } = createThreadHotkeys({
    messageListScopeId: props.messageListScopeId!,
    replySelection,
    isThreadFocused,
    isEditing: () => !!props.messageEditor?.state(),
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

  // NOTE: Intentionally reads from `thread().preview` instead of `activeReplies()`.
  // `activeReplies()` can access `repliesQuery.data` which triggers Suspense.
  // Preview data is always available synchronously and is sufficient here
  // since this only controls the reply rail connector color.
  const firstReplyIsNewMessage = () => {
    const preview = thread().preview ?? [];
    const first = preview[0];
    return first ? props.isNewMessage?.(first) : false;
  };

  const collapsedRepliesCount = () =>
    getCollapsedRepliesCount(thread().reply_count, DEFAULT_VISIBLE_REPLY_COUNT);
  const collapsedRepliesContainsNewMessages = () =>
    activeReplies()
      .slice(DEFAULT_VISIBLE_REPLY_COUNT)
      .some((reply: ApiThreadReply) => props.isNewMessage?.(reply));
  const collapsedReplyUsers = () =>
    getUniqueReplyUserIds(activeReplies().slice(DEFAULT_VISIBLE_REPLY_COUNT));
  const collapsedLatestReplyAt = () =>
    getThreadLatestReplyAt(thread().latest_reply_at, activeReplies());
  const shouldShowCollapsedIndicator = () =>
    !props.isReplying() && !props.isExpanded() && collapsedRepliesCount() > 0;
  const shouldShowReplyButton = () =>
    hasReplies() && !props.isReplying() && !shouldShowCollapsedIndicator();
  const [replyListHandle, setReplyListHandle] =
    createSignal<ThreadReplyListHandle>();

  createEffect(
    on(
      [() => props.selectedReplyId, () => props.targetReplyId, loadedReplies],
      ([selectedReplyId, _targetReplyId, replies]) => {
        if (!selectedReplyId) {
          if (replySelection.selectedId()) replySelection.clear();
          return;
        }
        const found = replies.some((r) => r.id === selectedReplyId);
        if (!found) {
          if (replySelection.selectedId()) replySelection.clear();
          return;
        }
        props.onSelectMessage?.(props.data().id);
        replySelection.select(selectedReplyId);
      }
    )
  );

  createEffect(
    on(
      [() => props.targetReplyId, displayReplies, props.isExpanded],
      ([targetReplyId, rendered, isExpanded]) => {
        if (!targetReplyId || isExpanded) return;
        if (rendered.some((r) => r.id === targetReplyId)) return;
        props.setIsExpanded(true);
      }
    )
  );

  // this stops re-scrolling to the same target
  let lastScrolledReplyId: string | undefined;
  createEffect(
    on(
      [
        () => props.targetReplyId,
        replyListHandle,
        canScrollToTargetReply,
        props.isExpanded,
      ],
      ([targetReplyId, handle, canScroll, isExpanded]) => {
        if (!targetReplyId) {
          lastScrolledReplyId = undefined;
          return;
        }
        if (lastScrolledReplyId === targetReplyId) return;
        if (!canScroll || !handle) return;

        // Untracked: channel-message reconciles must not re-fire scroll.
        const replies = isExpanded
          ? untrack(loadedReplies)
          : untrack(displayReplies);
        const index = replies.findIndex((r) => r.id === targetReplyId);
        if (index === -1) return;

        if (!handle.scrollToIndex(index)) return;
        lastScrolledReplyId = targetReplyId;
        props.onTargetReplyScrolled?.(targetReplyId);
      }
    )
  );

  return (
    <DebugSuspense name="ChannelThread.root">
      <Thread.Row
        message={props.data()}
        listMeta={props.listMeta}
        onDismissNewMessages={props.threadActions?.onDismissNewMessages}
      >
        <div class="flex flex-col w-full">
          <MarkMessageNotifications
            messageId={props.data().id}
            channelId={props.channelId()}
          >
            <DebugSuspense name="ChannelThread.message">
              <ChannelMessage
                channelId={props.channelId()}
                message={props.data()}
                actions={props.getMessageActions?.(props.data())}
                listMeta={props.listMeta}
                messageEditor={props.messageEditor}
                onClick={selectThreadMessage}
                highlighted={isSelected() && !isThreadFocused()}
                selectionState={
                  isSelected() && !isThreadFocused()
                    ? { isSelected: true }
                    : undefined
                }
              />
            </DebugSuspense>
          </MarkMessageNotifications>
          <Show when={hasReplies() || props.isReplying()}>
            <div class="relative w-full">
              <DebugSuspense name="ChannelThread.reply-rail">
                <Thread.ReplyRailDecorations
                  isReplying={props.isReplying}
                  firstThreadReplyNewMessage={firstReplyIsNewMessage()}
                />
              </DebugSuspense>
              <DebugSuspense name="ChannelThread.replies">
                <Thread.RepliesContainer>
                  <DebugSuspense name="ChannelThread.ReplyList">
                    <Thread.ReplyList
                      channelId={props.channelId()}
                      threadId={props.data().id}
                      replies={displayReplies()}
                      getMessageActions={props.getMessageActions}
                      messageEditor={props.messageEditor}
                      isNewMessage={props.isNewMessage}
                      onReady={setReplyListHandle}
                      selectedReplyId={replySelection.selectedId}
                      isThreadFocused={isThreadFocused}
                      onSelectReply={selectReply}
                    />
                  </DebugSuspense>

                  <Show when={props.isReplying()}>
                    <div
                      ref={(el) => {
                        attachReplyInputRef(el);
                        replyInputContainerRef = el;
                      }}
                      class="ph-no-capture"
                    >
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
                        setReplyInputEl={props.setReplyInputEl}
                        setReplyInputHandle={props.setReplyInputHandle}
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
                          onClick={() => props.setIsExpanded(true)}
                          hasNewMessages={collapsedRepliesContainsNewMessages()}
                        />
                      </Show>
                      <Show when={shouldShowReplyButton()}>
                        <Thread.ReplyButton
                          getFocusTarget={() =>
                            replyInputContainerRef?.querySelector<HTMLElement>(
                              '[contenteditable]'
                            ) ?? null
                          }
                          onClick={() => props.setIsReplying(true)}
                          aria-label="Reply"
                        />
                      </Show>
                    </Thread.ActionsFooter>
                  </Show>
                </Thread.RepliesContainer>
              </DebugSuspense>
            </div>
          </Show>
          <Show when={props.isNewestThread}>
            <ThreadTypingIndicator
              channelId={props.channelId()}
              threadId={null}
            />
          </Show>
        </div>
      </Thread.Row>
    </DebugSuspense>
  );
}
