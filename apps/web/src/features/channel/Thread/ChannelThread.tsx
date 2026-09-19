import { DebugSuspense } from '@channel/DebugSuspense';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import { MarkMessageNotifications } from '@notifications/components/MarkMessageNotifications';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import type { ApiThreadReply } from '@service-storage/generated/schemas/apiThreadReply';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { createMessageSelection } from '../Channel/create-message-selection';
import { ChannelMessage } from '../Message';
import { isUnifiedInputMode } from '../unified-input-mode';
import { createTargetReplyNavigationController } from './create-target-reply-navigation-controller';
import { createTargetReplyScroller } from './create-target-reply-scroller';
import { createThreadHotkeys } from './create-thread-hotkeys';
import { createThreadRepliesFetchGate } from './create-thread-replies-fetch-gate';
import { Thread } from './Thread';
import type { ThreadReplyListHandle } from './ThreadReplyList';
import { ThreadTypingIndicator } from './ThreadTypingIndicator';
import type { ThreadProps } from './types';
import { channelReplyInputOffsetX } from './utils/thread-rail-geometry';
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
  const displayName = () => getDisplayName(macroId());
  const thread = () => props.data().thread;
  const hasReplies = () => thread().reply_count > 0;
  const fetchRepliesEnabled = createThreadRepliesFetchGate({
    threadId: () => props.data().id,
    replyCount: () => thread().reply_count,
    isExpanded: props.isExpanded,
    isFindBarOpen: props.isFindBarOpen,
    targetThreadId: () => props.targetNavigation?.targetThreadId(),
    targetReplyId: () => props.targetNavigation?.targetReplyId(),
  });

  const isSelected = () => props.selectedMessageId?.() === props.data().id;

  // The unified input's reply binding, resolved against this thread.
  // `undefined` unless the binding points into this thread; otherwise it is
  // bound either to the root or to one of this thread's replies.
  const unifiedReplyBinding = () => {
    const target = props.unifiedReplyTarget;
    if (!isUnifiedInputMode() || target?.threadId !== props.data().id) {
      return undefined;
    }
    return { boundToRoot: !target.replyId, boundReplyId: target.replyId };
  };

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

  // Channel navigation landed on this root message (and not on one of its
  // replies).
  const isRootNavTargeted = () =>
    !!props.targetNavigation?.targetThreadId() &&
    props.targetNavigation.targetThreadId() === props.data().id &&
    !props.targetNavigation.activeTargetReplyId();

  const selectThreadMessage = () => {
    // Clicking the navigation-targeted message releases the target instead
    // of toggling selection.
    if (isRootNavTargeted()) {
      props.targetNavigation?.onClearTarget(props.data().id);
      return;
    }
    // On touch devices, we want to block "click to select"
    if (isTouchDevice()) return;
    if (isSelected() && !isThreadFocused()) {
      props.onClearSelection?.();
      return;
    }

    props.onSelectMessage?.(props.data().id);
    replySelection.clear();
  };

  const selectReply = (replyId: string) => {
    // Clicking the navigation-targeted reply releases the target instead of
    // toggling selection.
    if (props.targetNavigation?.activeTargetReplyId() === replyId) {
      props.targetNavigation.onClearTarget(props.data().id);
      return;
    }
    // On touch devices, we want to block "click to select"
    if (isTouchDevice()) return;
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
  // Replying to this thread — inline input open, or the unified input bound.
  const isReplyingToThread = () =>
    props.isReplying() || unifiedReplyBinding() !== undefined;
  const shouldShowCollapsedIndicator = () =>
    !isReplyingToThread() && !props.isExpanded() && collapsedRepliesCount() > 0;
  const replyAction = () => props.getMessageActions?.(props.data())?.onReply;
  const shouldShowReplyButton = () =>
    hasReplies() &&
    !!replyAction() &&
    !isReplyingToThread() &&
    !shouldShowCollapsedIndicator();
  const [replyListHandle, setReplyListHandle] =
    createSignal<ThreadReplyListHandle>();
  const [threadRowElement, setThreadRowElement] = createSignal<HTMLElement>();
  const targetMessageScroller = createTargetReplyScroller({
    getTarget: () =>
      threadRowElement()?.querySelector<HTMLElement>(
        `[data-message-id="${props.data().id}"]`
      ) ?? undefined,
    positionTarget: props.targetNavigation?.positionTarget,
  });

  createEffect(
    on(
      [() => props.targetNavigation?.targetMessageId(), threadRowElement],
      ([targetMessageId]) => {
        if (!targetMessageId || targetMessageId !== props.data().id) {
          targetMessageScroller.cancel();
          return;
        }
        targetMessageScroller.scrollToIndex(0, () => {
          props.targetNavigation?.onTargetMessageScrolled(targetMessageId);
        });
      }
    )
  );

  onCleanup(targetMessageScroller.dispose);

  createEffect(
    on(
      [
        () => props.targetNavigation?.activeTargetReplyId(),
        () => props.targetNavigation?.targetReplyId(),
        loadedReplies,
      ],
      ([activeTargetReplyId, _targetReplyId, replies]) => {
        if (!activeTargetReplyId) {
          return;
        }
        const found = replies.some((r) => r.id === activeTargetReplyId);
        if (!found) {
          if (replySelection.selectedId()) replySelection.clear();
          return;
        }
        props.onSelectMessage?.(props.data().id);
        replySelection.select(activeTargetReplyId);
      }
    )
  );

  const targetReplyNavigation = createTargetReplyNavigationController();
  createEffect(
    on(
      [
        () => props.targetNavigation?.targetReplyId(),
        replyListHandle,
        canScrollToTargetReply,
        props.isExpanded,
      ],
      ([targetReplyId, handle, canScroll, isExpanded]) => {
        // Untracked: channel-message reconciles must not re-fire scroll.
        const replies =
          targetReplyId && canScroll && handle
            ? isExpanded
              ? untrack(loadedReplies)
              : untrack(displayReplies)
            : [];
        targetReplyNavigation.update({
          targetReplyId,
          handle,
          canScroll,
          replies,
          getCurrentTargetReplyId: () =>
            props.targetNavigation?.targetReplyId(),
          onScrolled: props.targetNavigation?.onTargetReplyScrolled,
        });
      }
    )
  );

  onCleanup(targetReplyNavigation.dispose);

  return (
    <DebugSuspense name="ChannelThread.root">
      <Thread.Row
        ref={setThreadRowElement}
        channelId={props.channelId()}
        message={props.data()}
        listMeta={props.listMeta}
        onDismissNewMessages={props.threadActions?.onDismissNewMessages}
      >
        <div class="flex flex-col w-full">
          {/* Rail segment along the root message: from the avatar's center
              (masked by the avatar's fill until its lower edge) to the
              message's bottom, where the reply-branch elbow takes over. A
              grouped root has no avatar — its segment enters from the row
              top (fed by the run's pass-through rails) and a fork node on
              the spine marks which message the thread replies to. Plain
              messages carry no rail. */}
          <div class="relative">
            <Thread.RootRail
              visible={hasReplies() || isReplyingToThread()}
              grouped={props.listMeta?.isGroupedWithPrevious}
            />
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
                  participants={props.participants}
                  onClick={selectThreadMessage}
                  selected={isSelected() && !isThreadFocused()}
                  targeted={
                    // The unified input's reply is bound to this root, or
                    // channel navigation landed on it.
                    unifiedReplyBinding()?.boundToRoot || isRootNavTargeted()
                  }
                />
              </DebugSuspense>
            </MarkMessageNotifications>
          </div>
          <Show
            when={hasReplies() || (props.isReplying() && !isUnifiedInputMode())}
          >
            <div class="relative w-full">
              <Thread.RepliesBridgeRail />
              {/* Terminal branch: the spine's final curve into the footer
                  button's left edge. Its vertical part starts exactly at the
                  last reply row's bottom (button h-8 + mb-2 + container pb). */}
              <Show
                when={shouldShowCollapsedIndicator() || shouldShowReplyButton()}
              >
                <Thread.TerminalRail />
              </Show>
              <DebugSuspense name="ChannelThread.replies">
                <Thread.RepliesContainer>
                  <DebugSuspense name="ChannelThread.ReplyList">
                    <Thread.ReplyList
                      channelId={props.channelId()}
                      threadId={props.data().id}
                      replies={displayReplies()}
                      getMessageActions={props.getMessageActions}
                      messageEditor={props.messageEditor}
                      participants={props.participants}
                      isNewMessage={props.isNewMessage}
                      onReady={setReplyListHandle}
                      positionTarget={props.targetNavigation?.positionTarget}
                      selectedReplyId={replySelection.selectedId}
                      targetedReplyId={() =>
                        props.targetNavigation?.activeTargetReplyId() ??
                        unifiedReplyBinding()?.boundReplyId
                      }
                      isThreadFocused={isThreadFocused}
                      onSelectReply={selectReply}
                    />
                  </DebugSuspense>

                  <Show when={props.isReplying() && !isUnifiedInputMode()}>
                    <div
                      ref={(el) => {
                        attachReplyInputRef(el);
                        replyInputContainerRef = el;
                      }}
                      class="ph-no-capture relative"
                    >
                      {/* The first reply has an author avatar before its
                          composer, so this branch turns at the avatar's
                          center. Once replies exist, it instead joins the
                          composer at its vertical center. */}
                      <div
                        class="pointer-events-none absolute top-0 -z-1 channel-rail-left channel-rail-bottom border-thread-rail rounded-bl-[14px]"
                        style={{
                          left: 'calc(var(--user-icon-width) / 2 + var(--message-padding-x) - var(--thread-shift) - var(--channel-rail-width) / 2)',
                          width:
                            'calc(var(--thread-shift) - var(--user-icon-width) / 2 - var(--channel-rail-clearance))',
                          ...(hasReplies()
                            ? { bottom: '50%' }
                            : {
                                height:
                                  'calc(var(--message-padding-x) + var(--user-icon-width) / 2)',
                              }),
                        }}
                      />
                      <Show when={!hasReplies()}>
                        <Thread.ReplyAuthor
                          userId={replyUserId()}
                          displayName={displayName()}
                        />
                      </Show>
                      <Thread.ReplyInput
                        connector={false}
                        offsetX={channelReplyInputOffsetX}
                        channelId={props.channelId()}
                        messageId={props.data().id}
                        replyInputState={props.replyInputState}
                        setReplyInputState={props.setReplyInputState}
                        setIsReplying={props.setIsReplying}
                        replyInputHandle={props.replyInputHandle}
                        setReplyInputEl={props.setReplyInputEl}
                        setReplyInputHandle={props.setReplyInputHandle}
                        focusRequest={props.replyInputFocusRequest}
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
                            !isUnifiedInputMode()
                              ? (replyInputContainerRef?.querySelector<HTMLElement>(
                                  '[contenteditable]'
                                ) ?? null)
                              : document.querySelector<HTMLElement>(
                                  `[data-input-id="thread-reply-input-${props.data().id}"] [contenteditable]`
                                )
                          }
                          onClick={(event) =>
                            replyAction()?.({ message: props.data(), event })
                          }
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
