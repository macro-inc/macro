import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { createActivityTracker } from '@channel/activity-tracker';
import { DebugSuspense } from '@channel/DebugSuspense';
import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import {
  TaskModeChannelInput,
  type TaskModeChannelInputProps,
} from '@channel/Input/TaskModeChannelInput';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
  makeTaskPersistence,
} from '@channel/Input/utils/persistence';
import {
  type MessageData,
  SearchHighlightTermsProvider,
} from '@channel/Message';
import { MaybeMessageActionDrawerManager } from '@channel/Mobile/MessageActionDrawerManager';
import { useChannelBotMentionUsers } from '@channel/use-channel-bot-mention-users';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import {
  EntityLoadGate,
  toEntityLoadError,
} from '@core/component/EntityLoadGate';
import { FindBar } from '@core/component/FindBar';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import {
  useChannelActivity,
  useChannelName,
  useChannelType,
} from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { DateValue } from '@core/util/date';
import {
  extractUserMentions,
  trimEdgeUserMentions,
} from '@core/util/taskExtraction';
import {
  buildMentionMarkdownString,
  markdownToPlainText,
} from '@macro-inc/lexical-core';
import {
  invalidateChannelsActivity,
  useUpdateChannelsActivityMutation,
} from '@queries/channel/activity';
import {
  type ChannelMessagesData,
  createMessageIndex,
  getChannelMessagesQueryKey,
  isMissingChannelMessageError,
  useChannelMessagesQuery,
} from '@queries/channel/channel-messages';
import {
  useDeleteMessageMutation,
  usePatchMessageMutation,
  useSendMessageMutation,
} from '@queries/channel/message';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/channel/reaction';
import { threadRepliesQueryOptions } from '@queries/channel/thread-replies';
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
import { queryClient } from '@queries/client';
import { ChannelTypeEnum } from '@service-storage/client';
import { useBeforeLeave } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  createInputAttachmentTracker,
  type InputHandle,
  type InputSnapshot,
} from '../Input';
import { ChannelInputContainer } from '../Input/ChannelInputContainer';
import { hasSendableInputContent } from '../Input/utils/sendable-content';
import { ChannelThread } from '../Thread';
import { buildQuoteReplyValue } from '../Thread/utils/message-actions';
import { isUnifiedInputMode } from '../unified-input-mode';
import { ActiveCallMessage } from './ActiveCallMessage';
import { ChannelDropZone } from './ChannelDropZone';
import { createChannelDragState } from './create-channel-drag-state';
import { createChannelFindBar } from './create-channel-find-bar';
import { createChannelHotkeys } from './create-channel-hotkeys';
import { createChannelKeyboardHandler } from './create-channel-keyboard-handler';
import { createChannelMessageActions } from './create-channel-message-actions';
import { createDeleteMessageConfirmation } from './create-delete-message-confirmation';
import { createMessageEditor } from './create-message-editor';
import { createMessageSelection } from './create-message-selection';
import {
  clearStaleRestoredChannelData,
  createTargetMessageController,
  type TargetMessageController,
} from './create-target-message-controller';
import { buildChannelMessageListMeta } from './message-list-meta';
import { ScrollToBottomOverlay } from './ScrollToBottomOverlay';
import { createStickyScrollEffect } from './sticky-scroll';
import {
  defaultThreadListTargetFromMessage,
  ThreadList,
  type ThreadListNavigation,
  type ThreadListScrollSnapshot,
  type ThreadListScrollState,
  type ThreadListScrollTarget,
} from './ThreadList';
import {
  createThreadManager,
  type ThreadManagerSnapshot,
} from './thread-manager';
import { createThreadPaginator } from './thread-paginator';
import { UnifiedEditInput } from './UnifiedEditInput';
import { UnifiedReplyInput } from './UnifiedReplyInput';
import {
  createUnifiedInputManager,
  type UnifiedReplyTargetSnapshot,
} from './unified-input-manager';

export type ChannelProps = {
  channelId: string;
  targetMessageId?: string | undefined;
  targetMessageReplyId?: string | undefined;
  lastViewedAt?: DateValue | null;
  initialMessagesStateSnapshot?: ChannelMessagesStateSnapshot;
  onHandleReady?: (handle: ChannelHandle) => void;
  /** Whether to auto-focus the channel input on mount. Defaults to `!isTouchDevice()`. */
  autofocus?: boolean;
};

export type ChannelMessagesStateSnapshot = {
  scroll?: ThreadListScrollSnapshot;
  threads?: ThreadManagerSnapshot;
  /** The unified input's reply binding, persisted by ids only. */
  replyTarget?: UnifiedReplyTargetSnapshot;
};

export type ChannelHandle = {
  goToMessage: TargetMessageController['goToMessage'];
  goToLatest: () => void;
  getMessagesStateSnapshot: () => ChannelMessagesStateSnapshot | undefined;
};

export function Channel(props: ChannelProps) {
  const userId = useUserId();
  const splitPanel = useSplitPanel();

  // Full-frame mobile/tablet: the thread list spans the whole screen and messages
  // scroll behind the floating header islands (top) and the floating
  // input + dock (bottom). contentOffsetTop already includes the safe area.
  const threadListScrollInsets = () =>
    isTouchDevice()
      ? {
          start: splitPanel?.contentOffsetTop() ?? 0,
          // '4' here is a magic offset so that the ThreadRail correctly hits the the curved edge of the floating input. Not idea, but low impact and it works.
          end: FloatRegions.hostHeight() - 4,
        }
      : { start: 0, end: 0 };

  const sendMessageMutation = useSendMessageMutation();
  const patchMessageMutation = usePatchMessageMutation();
  const deleteMessageMutation = useDeleteMessageMutation();
  const typingMutation = usePostTypingUpdateMutation();
  const addReactionMutation = useAddReactionMutation();
  const removeReactionMutation = useRemoveReactionMutation();

  const [threadListNavigation, setThreadListNavigation] =
    createSignal<ThreadListNavigation>();
  const [threadListScrollState, setThreadListScrollState] =
    createSignal<ThreadListScrollState>();
  // Hosts the swipe-to-reply gesture listeners (mobile).
  const [threadListContainerEl, setThreadListContainerEl] =
    createSignal<HTMLElement>();

  // When opening without a target, clear stale data that was previously
  // restored from a load-around session so the query fetches from the bottom.
  if (!props.targetMessageId) {
    clearStaleRestoredChannelData(props.channelId);
  }

  const targetMessageController = createTargetMessageController({
    channelId: () => props.channelId,
    initialTargetMessageId: props.targetMessageId,
    initialTargetMessageReplyId: props.targetMessageReplyId,
    // changing the array reference is required to trigger the scroll effect
    messageKeys: () => [...messageIndex.keys],
    navigation: threadListNavigation,
    didInitialScroll: () => threadListScrollState()?.didInitialScroll ?? false,
  });

  const [channelInputSnapshot, setChannelInputSnapshot] =
    createSignal<InputSnapshot>();
  const [channelInputHandle, setChannelInputHandle] =
    createSignal<InputHandle>();

  const messagesQuery = useChannelMessagesQuery(
    () => props.channelId,
    targetMessageController.loadAroundMessageId
  );
  const isTargetMessageMissing = () =>
    targetMessageController.loadAroundMessageId() !== undefined &&
    isMissingChannelMessageError(messagesQuery.error);
  const messagesLoadResult = {
    data: () => messagesQuery.data,
    // Pagination and background-refresh errors should not replace content that
    // has already loaded. Only initial-loading errors belong to the gate.
    error: () =>
      messagesQuery.isLoadingError && !isTargetMessageMissing()
        ? toEntityLoadError(messagesQuery.error)
        : undefined,
    // Keep the loading view mounted while the missing-target handler switches
    // the query back to the latest page.
    isPending: () => messagesQuery.isPending || isTargetMessageMissing(),
  };

  createEffect(
    on(
      [targetMessageController.loadAroundMessageId, () => messagesQuery.error],
      ([loadAroundMessageId, error]) => {
        if (!loadAroundMessageId || !isMissingChannelMessageError(error))
          return;

        toast.alert('Message no longer available', {
          subtext: 'Showing the latest messages instead.',
        });
        clearStaleRestoredChannelData(props.channelId);
        targetMessageController.reset();
      }
    )
  );

  const messageIndex = createMessageIndex(
    () => messagesQuery.data as ChannelMessagesData | undefined
  );

  const messages = createMemo(() => [...messageIndex.items]);
  const messageById = () => messageIndex.byId;
  const keepMountedTargetThreadIndexes = createMemo(() => {
    const threadId = targetMessageController.activeTargetMessageId();
    const hasPendingElementScroll =
      targetMessageController.pendingScrollTargetId() !== undefined ||
      targetMessageController.pendingTargetReplyId() !== undefined;
    if (!threadId || !hasPendingElementScroll) return [];

    const index = messageIndex.keys.indexOf(threadId);
    return index === -1 ? [] : [index];
  });

  const participants = useChannelParticipants(() => props.channelId);
  const channelBotMentionUsers = useChannelBotMentionUsers(
    () => props.channelId
  );

  const activity = useChannelActivity(props.channelId);

  const updateActivityMutation = useUpdateChannelsActivityMutation({
    onSuccess: () => {
      invalidateChannelsActivity();
    },
  });

  const markAsViewed = () => {
    updateActivityMutation.mutate({
      channelId: props.channelId,
      activityType: 'view',
    });
  };

  onMount(() => {
    markAsViewed();
  });

  onCleanup(() => {
    markAsViewed();
  });

  useBeforeLeave(() => {
    markAsViewed();
  });

  const unifiedInput = createUnifiedInputManager({
    initialReplyTarget: props.initialMessagesStateSnapshot?.replyTarget,
    // Clear any highlight left by tapping the reply flag's navigate action.
    onReplyThreadReleased: (threadId) => releaseSelectionAndTarget(threadId),
  });

  const threadManager = createThreadManager(
    props.initialMessagesStateSnapshot?.threads
  );

  const prepareTargetReply = (threadId: string) => {
    // Expand before the virtualized row mounts so navigation never presents a
    // collapsed parent and then grows it in the viewport.
    threadManager.getOrCreateThreadState(threadId).setIsExpanded(true);
    // Reply data and the load-around message window can load in parallel. The
    // mounted query reuses this request and remains the owner of render state.
    void queryClient.prefetchQuery(
      threadRepliesQueryOptions(props.channelId, threadId)
    );
  };

  if (props.targetMessageId && props.targetMessageReplyId) {
    prepareTargetReply(props.targetMessageId);
  }

  const threadPaginator = createThreadPaginator(messagesQuery);
  const messageEditor = createMessageEditor({
    channelId: () => props.channelId,
    participantIds: () => participants.ids(),
    patchMessage: patchMessageMutation.mutate,
    onEditEnded: (message) => {
      // Clear any highlight left by tapping the edit flag's navigate action
      // (which selects and nav-targets the edited message's thread).
      if (isUnifiedInputMode()) {
        releaseSelectionAndTarget(message.thread_id ?? message.id);
      }
    },
  });

  const threadListInitialScrollTarget: Accessor<ThreadListScrollTarget> = () =>
    defaultThreadListTargetFromMessage(
      targetMessageController.activeTargetMessageId()
    );

  const shift = () => threadPaginator.isShifting();

  const activityTracker = createActivityTracker({
    lastViewedAt: () => activity()?.viewed_at,
    userId,
  });

  const listMetaByMessageId = createMemo(() =>
    buildChannelMessageListMeta(
      messages(),
      activityTracker.isNewMessage,
      // Once there are no older pages left to fetch, the oldest loaded message
      // (index 0) is the true first message in the channel.
      !messagesQuery.hasNextPage,
      // A reply being composed opens the thread before any reply exists; the
      // rail must already reach it. Signal reads keep this memo live.
      (message) =>
        threadManager.getOrCreateThreadState(message.id).isReplying() ||
        unifiedInput.replyTarget()?.threadId === message.id
    )
  );

  const attachmentTracker = createInputAttachmentTracker({
    persistenceKey: makeAttachmentTrackerPersistenceKey({
      channelId: props.channelId,
    }),
  });

  const dragState = createChannelDragState({
    channelId: props.channelId,
  });

  const channelName = useChannelName(props.channelId);
  const channelType = useChannelType(props.channelId);
  const { popoverSplit, openWithSplit } = useSplitLayout();

  // Placeholder name: channels render as "#name"; a 1:1 DM named "First Last"
  // shortens to the first name, and group DMs like "A, B" keep their full name.
  const inputPlaceholderName = () => {
    const name = channelName();
    if (!name) return undefined;
    if (channelType() !== ChannelTypeEnum.DirectMessage) return `#${name}`;
    const parts = name.split(' ');
    return parts.length === 2 && !parts[0]?.endsWith(',') ? parts[0] : name;
  };

  const inputPlaceholder = () => {
    const name = inputPlaceholderName();
    return name ? `Type @ to share with ${name}` : 'Type @ to share';
  };

  const buildChannelMessageMention = (message: {
    id: string;
    thread_id?: string | null;
  }) =>
    buildMentionMarkdownString({
      type: 'document',
      documentId: props.channelId,
      documentName: channelName() ?? '',
      blockName: 'channel',
      blockParams: {
        channel_message_id: message.id,
        ...(message.thread_id && { channel_thread_id: message.thread_id }),
      },
    });

  const openReplyInput = (message: MessageData) => {
    const threadId = message.thread_id ?? message.id;
    const state = threadManager.getOrCreateThreadState(threadId);
    if (isUnifiedInputMode()) {
      unifiedInput.bindReply(message);
      state.setIsExpanded(true);
    } else {
      state.setIsReplying(true);
    }
    state.replyInputFocusRequest.request();
    return state;
  };

  const openQuoteReplyInput = (message: MessageData) => {
    const threadId = message.thread_id ?? message.id;
    const state = threadManager.getOrCreateThreadState(threadId);
    const beforeSnapshot = state.replyInputState();
    const nextSnapshot: InputSnapshot = {
      value: buildQuoteReplyValue({
        quotedContent: message.content,
        existingValue: beforeSnapshot?.value,
      }),
      mentions: beforeSnapshot?.mentions ?? [],
      attachments: beforeSnapshot?.attachments ?? [],
    };

    state.setReplyInputState(nextSnapshot);
    if (isUnifiedInputMode()) {
      unifiedInput.bindReply(message);
      state.setIsExpanded(true);
    } else {
      state.setIsReplying(true);
    }
    requestAnimationFrame(() => {
      state.replyInputHandle?.()?.restoreSnapshot(nextSnapshot, {
        focus: false,
        cursor: 'trailing-paragraph',
      });
      state.replyInputFocusRequest.request();
    });
  };

  const deleteConfirmation = createDeleteMessageConfirmation(
    deleteMessageMutation.mutate
  );

  const getMessageActions = createChannelMessageActions({
    channelId: () => props.channelId,
    userId,
    deleteMessage: deleteConfirmation.requestDelete,
    addReaction: addReactionMutation.mutate,
    removeReaction: removeReactionMutation.mutate,
    onReply: (ctx) => {
      if (ctx.message.thread_id) {
        openQuoteReplyInput(ctx.message);
        return;
      }
      openReplyInput(ctx.message);
    },
    onEdit: ({ message }) => {
      messageEditor.start(message);
    },
    onCreateTask: (ctx) => {
      const trimmedMarkdown = trimEdgeUserMentions(ctx.message.content);
      const plainText = markdownToPlainText(trimmedMarkdown).trim();
      const title =
        plainText.length > 70 ? `${plainText.slice(0, 70)}...` : plainText;
      const mentionedUserIds = extractUserMentions(ctx.message.content);
      popoverSplit({
        type: 'component',
        id: 'task-compose',
        params: {
          initialTitle: title,
          initialContent: buildChannelMessageMention(ctx.message),
          initialAssigneeIds:
            mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
        },
      });
    },
    onChat: (ctx) => {
      openChatWithInput(`${buildChannelMessageMention(ctx.message)}\n\n`);
    },
  });

  const selection = createMessageSelection({
    keys: () => messageIndex.keys,
  });

  const selectMessage = (messageId: string) => {
    selection.select(messageId);
  };

  const clearSelection = () => {
    selection.clear();
  };

  const goToMessage: ChannelHandle['goToMessage'] = (messageId, replyId) => {
    if (replyId) {
      clearSelection();
      prepareTargetReply(messageId);
    } else {
      selectMessage(messageId);
    }
    targetMessageController.goToMessage(messageId, replyId);
  };

  const releaseSelectionAndTarget = (threadId: string) => {
    if (selection.selectedId() === threadId) clearSelection();
    targetMessageController.clearActiveTarget(threadId);
  };

  const [threadListScrollSnapshot, setThreadListScrollSnapshot] = createSignal<
    ThreadListScrollSnapshot | undefined
  >(props.initialMessagesStateSnapshot?.scroll);

  const getMessagesStateSnapshot: ChannelHandle['getMessagesStateSnapshot'] =
    () => {
      const scroll = threadListScrollSnapshot();
      const threads = threadManager.getSnapshot();
      const boundReplyTarget = unifiedInput.getReplyTargetSnapshot();
      if (!scroll && !threads && !boundReplyTarget) return undefined;
      return {
        ...(scroll ? { scroll } : {}),
        ...(threads ? { threads } : {}),
        ...(boundReplyTarget ? { replyTarget: boundReplyTarget } : {}),
      };
    };

  const findBar = createChannelFindBar({
    channelId: () => props.channelId,
    goToMessage,
    clearSelection,
    isMessageLoaded: (id) => messageIndex.keys.includes(id),
  });

  const handleScrollToBottom = () => {
    if (messagesQuery.hasPreviousPage) {
      targetMessageController.reset();
      const defaultKey = getChannelMessagesQueryKey(props.channelId, null);
      queryClient.resetQueries({ queryKey: defaultKey });
    } else {
      threadListNavigation()?.scrollToBottom('end');
    }
  };

  const [pendingScrollToLatest, setPendingScrollToLatest] = createSignal(false);

  const goToLatest: ChannelHandle['goToLatest'] = () => {
    handleScrollToBottom();
    setPendingScrollToLatest(true);
  };

  // When handleScrollToBottom resets a mid-history slice, the newest page
  // arrives asynchronously and swaps the message set, so a single scroll can
  // settle mid-list. Keep scrolling until the viewport rests at the bottom of
  // fully loaded data.
  createEffect(() => {
    if (!pendingScrollToLatest()) return;
    // A specific message navigation supersedes scroll-to-latest: once a target
    // scroll is pending, abandon the latest-scroll so it can't yank the view
    // back to the bottom.
    if (targetMessageController.pendingScrollTargetId()) {
      setPendingScrollToLatest(false);
      return;
    }
    const navigation = threadListNavigation();
    const scrollState = threadListScrollState();
    if (!navigation || !scrollState?.didInitialScroll) return;
    if (messageIndex.keys.length === 0) return;
    if (messagesQuery.isFetching || messagesQuery.hasPreviousPage) return;
    if (scrollState.isNearBottom) {
      setPendingScrollToLatest(false);
      return;
    }
    navigation.scrollToBottom('end');
  });

  const { messageListScopeId, attachMessageListRef, attachInputRef } =
    createChannelHotkeys({
      selection,
      navigation: threadListNavigation,
      messageById,
      getMessageActions,
      userId,
      isEditing: () => !!messageEditor.state(),
      isInputEmpty: () =>
        (channelInputSnapshot()?.value.trim().length ?? 0) === 0,
      onOpenFindBar: findBar.open,
      onGoToBottom: handleScrollToBottom,
    });

  createStickyScrollEffect({
    isNearBottom: () => threadListScrollState()?.isNearBottom ?? false,
    hasMoreBelow: () => threadPaginator.hasMorePrepend(),
    messages,
    scrollToBottom: () => threadListNavigation()?.scrollToBottom(),
  });

  createChannelKeyboardHandler({
    navigation: threadListNavigation,
    isNearBottom: () => threadListScrollState()?.isNearBottom ?? false,
    // The unified input's current binding — the edited message (the edit
    // face covers the reply face), else the reply target.
    boundMessageId: () => {
      const editing = messageEditor.state();
      if (editing) return editing.messageId;
      const replyTarget = unifiedInput.replyTarget();
      return replyTarget
        ? (replyTarget.replyId ?? replyTarget.threadId)
        : undefined;
    },
  });

  const onSend: ChannelInputProps['onSend'] = (snapshot) => {
    const senderId = userId();
    if (!senderId) return;
    const payload = buildPostMessageSendPayload({
      snapshot,
      participantIds: participants.ids(),
    });

    sendMessageMutation.mutate(
      {
        channelID: props.channelId,
        senderId,
        optimisticId: crypto.randomUUID(),
        ...payload,
      },
      {
        onError: () => {
          const handle = channelInputHandle();
          if (!handle) return;
          const current = channelInputSnapshot();
          if (current && hasSendableInputContent(current)) return;
          handle.restoreSnapshot(snapshot);
        },
      }
    );
  };

  // Task mode: post the freshly created task into the channel as a message
  // carrying a task mention.
  const onSendTask: TaskModeChannelInputProps['onSendTask'] = (task) => {
    const senderId = userId();
    if (!senderId) return;
    sendMessageMutation.mutate(
      {
        channelID: props.channelId,
        senderId,
        optimisticId: crypto.randomUUID(),
        message: {
          content: buildMentionMarkdownString({
            type: 'document',
            documentId: task.documentId,
            documentName: task.title,
            blockName: 'task',
          }),
          mentions: [{ entity_type: 'document', entity_id: task.documentId }],
          attachments: [],
        },
        optimisticAttachments: [],
      },
      {
        // The task itself was created before this send, so don't restore the
        // composer (retrying there would create a duplicate) — point at the
        // task instead.
        onError: () => {
          toast.failure('Task created, but sharing it to the channel failed', {
            actions: [
              {
                label: 'Open task',
                onClick: () =>
                  openWithSplit(
                    { type: 'task', id: task.documentId },
                    { referredFrom: null }
                  ),
              },
            ],
          });
        },
      }
    );
  };

  const isChannelReady = () => {
    return (
      messagesQuery.isFetched &&
      threadListNavigation() &&
      threadListScrollState()?.didInitialScroll
    );
  };

  createEffect(
    on(isChannelReady, () => {
      if (props.onHandleReady)
        props.onHandleReady({
          goToMessage,
          goToLatest,
          getMessagesStateSnapshot,
        });
    })
  );

  return (
    <EntityLoadGate
      result={messagesLoadResult}
      loadErrorTitle="Unable to load this channel"
      onRetry={() => void messagesQuery.refetch()}
    >
      <DebugSuspense name="Channel.root">
        <deleteConfirmation.ConfirmationDialog />
        <StaticMarkdownContext>
          <SearchHighlightTermsProvider
            value={findBar.getSearchTermsForMessage}
          >
            <MaybeMessageActionDrawerManager>
              <ChannelDropZone dragState={dragState}>
                <div
                  class="ph-no-capture relative flex-1 min-h-0 outline-none flex flex-col"
                  ref={(element) => {
                    attachMessageListRef(element);
                  }}
                  tabIndex={-1}
                  data-channel-message-list
                >
                  <Show when={findBar.isOpen()}>
                    <FindBar
                      class="absolute top-2 right-3 z-10 w-80 max-w-[calc(100%-1.5rem)] touch:top-[calc(var(--mobile-content-inset-top,0)+0.5rem)]"
                      controller={findBar}
                      direction="desc"
                    />
                  </Show>
                  <Show when={messages().length > 0}>
                    <div
                      class="relative flex-1 min-h-0"
                      ref={setThreadListContainerEl}
                    >
                      <SwipableRowProvider
                        container={threadListContainerEl}
                        triggerBehavior="spring-back"
                      >
                        <ThreadList
                          channelId={props.channelId}
                          keys={() => messageIndex.keys}
                          initialScrollTarget={threadListInitialScrollTarget()}
                          initialScrollHandledByTargetElement={
                            targetMessageController.pendingScrollTargetId() !==
                            undefined
                          }
                          keepMounted={keepMountedTargetThreadIndexes}
                          fullFrameScrollInsets={threadListScrollInsets}
                          shift={shift}
                          prepend={threadPaginator.isPrepending}
                          onScrollNearTop={threadPaginator.shiftPaginate}
                          onScrollNearBottom={threadPaginator.prependPaginate}
                          onNavigationReady={setThreadListNavigation}
                          onScrollStateChange={setThreadListScrollState}
                          initialScrollSnapshot={
                            props.targetMessageId
                              ? undefined
                              : props.initialMessagesStateSnapshot?.scroll
                          }
                          onScrollSnapshotChange={setThreadListScrollSnapshot}
                        >
                          {(item) => {
                            const message = () => messageById().get(item.id);
                            const state = threadManager.getOrCreateThreadState(
                              item.id
                            );
                            const isNewestThread = () =>
                              item.id === messageIndex.keys.at(-1);

                            return (
                              <Show when={message()}>
                                {(m) => (
                                  <ChannelThread
                                    data={m}
                                    channelId={() => props.channelId}
                                    isNewestThread={isNewestThread()}
                                    getMessageActions={getMessageActions}
                                    isFindBarOpen={findBar.isOpen}
                                    targetNavigation={{
                                      targetThreadId:
                                        targetMessageController.activeTargetMessageId,
                                      targetMessageId: () =>
                                        !targetMessageController.pendingTargetReplyId()
                                          ? targetMessageController.pendingScrollTargetId()
                                          : undefined,
                                      targetReplyId: () =>
                                        targetMessageController.pendingScrollTargetId()
                                          ? undefined
                                          : targetMessageController.pendingTargetReplyId(),
                                      activeTargetReplyId:
                                        targetMessageController.activeTargetMessageReplyId,
                                      positionTarget: (
                                        threadRow,
                                        targetElement
                                      ) =>
                                        threadListNavigation()?.scrollToElementInItem(
                                          item.id,
                                          threadRow,
                                          targetElement
                                        ) ?? false,
                                      onTargetMessageScrolled:
                                        targetMessageController.completePendingScroll,
                                      onTargetReplyScrolled: (replyId) => {
                                        targetMessageController.completePendingReplyScroll(
                                          item.id,
                                          replyId
                                        );
                                      },
                                      onClearTarget: releaseSelectionAndTarget,
                                    }}
                                    unifiedReplyTarget={unifiedInput.replyTarget()}
                                    isExpanded={state.isExpanded}
                                    setIsExpanded={state.setIsExpanded}
                                    isReplying={state.isReplying}
                                    setIsReplying={state.setIsReplying}
                                    replyInputState={state.replyInputState}
                                    setReplyInputState={
                                      state.setReplyInputState
                                    }
                                    setReplyInputEl={state.setReplyInputEl}
                                    replyInputHandle={state.replyInputHandle}
                                    setReplyInputHandle={
                                      state.setReplyInputHandle
                                    }
                                    replyInputFocusRequest={
                                      state.replyInputFocusRequest
                                    }
                                    listMeta={listMetaByMessageId()[item.id]}
                                    messageEditor={messageEditor}
                                    participants={participants.users}
                                    threadActions={{
                                      onDismissNewMessages:
                                        activityTracker.dismissNewMessages,
                                    }}
                                    isNewMessage={activityTracker.isNewMessage}
                                    selectedMessageId={selection.selectedId}
                                    onSelectMessage={selectMessage}
                                    onClearSelection={clearSelection}
                                    messageListScopeId={messageListScopeId}
                                  />
                                )}
                              </Show>
                            );
                          }}
                        </ThreadList>
                      </SwipableRowProvider>
                      <Show when={!findBar.isOpen()}>
                        <ScrollToBottomOverlay
                          scrollState={threadListScrollState}
                          onScrollToBottom={handleScrollToBottom}
                          class="touch:top-[calc(var(--mobile-content-inset-top,0)+1rem)]"
                        />
                      </Show>
                    </div>
                  </Show>
                  <DebugSuspense name="Channel.active-call">
                    <ActiveCallMessage channelId={props.channelId} />
                  </DebugSuspense>
                </div>
                <DebugSuspense name="Channel.input">
                  <FloatRegionOrInline region="accessory">
                    <ChannelInputContainer
                      ref={(el) => {
                        attachInputRef(el);
                      }}
                    >
                      <Switch>
                        <Match
                          when={
                            isUnifiedInputMode() &&
                            messageEditor.state()?.messageId
                          }
                          keyed
                        >
                          {(_messageId) => (
                            <UnifiedEditInput
                              channelId={props.channelId}
                              messageEditor={messageEditor}
                              onNavigateToMessage={(message) =>
                                goToMessage(
                                  message.thread_id ?? message.id,
                                  message.thread_id ? message.id : undefined
                                )
                              }
                            />
                          )}
                        </Match>
                        <Match
                          when={
                            isUnifiedInputMode() &&
                            unifiedInput.replyTarget()?.threadId
                          }
                          keyed
                        >
                          {(threadId) => (
                            <UnifiedReplyInput
                              channelId={props.channelId}
                              threadId={threadId}
                              state={threadManager.getOrCreateThreadState(
                                threadId
                              )}
                              getTargetMessage={() => {
                                const target = unifiedInput.replyTarget();
                                if (target?.message) return target.message;
                                // A restored quote-reply has no resolvable
                                // message (messageById only indexes thread
                                // roots) — don't misattribute it to the root.
                                if (target?.replyId) return undefined;
                                return messageById().get(threadId);
                              }}
                              threadHasReplies={() =>
                                (messageById().get(threadId)?.thread
                                  .reply_count ?? 0) > 0
                              }
                              onNavigateToTarget={() =>
                                goToMessage(
                                  threadId,
                                  unifiedInput.replyTarget()?.replyId
                                )
                              }
                              onExit={unifiedInput.closeReply}
                            />
                          )}
                        </Match>
                        <Match when={true}>
                          <TaskModeChannelInput
                            autofocus={props.autofocus}
                            collapsible
                            input={{
                              mode: 'channel',
                              id: `channel-input-${props.channelId}`,
                              placeholder: inputPlaceholder(),
                            }}
                            participants={participants.users}
                            bots={channelBotMentionUsers}
                            attachmentTracker={attachmentTracker}
                            persistenceKey={makeInputValuePersistenceKey({
                              channelId: props.channelId,
                            })}
                            onReady={(handle) => {
                              dragState.setAttachFilesToChannel(
                                handle.attachFiles
                              );
                              dragState.setEntityMentionInputHandlers(handle);
                              setChannelInputHandle(handle);
                            }}
                            onChange={(snapshot) =>
                              void setChannelInputSnapshot(snapshot)
                            }
                            onSend={onSend}
                            onSendTask={onSendTask}
                            taskPersistence={makeTaskPersistence({
                              channelId: props.channelId,
                            })}
                            onStartTyping={() =>
                              typingMutation.mutate({
                                channelId: props.channelId,
                                action: 'start',
                              })
                            }
                            onStopTyping={() =>
                              typingMutation.mutate({
                                channelId: props.channelId,
                                action: 'stop',
                              })
                            }
                          />
                        </Match>
                      </Switch>
                    </ChannelInputContainer>
                  </FloatRegionOrInline>
                </DebugSuspense>
              </ChannelDropZone>
            </MaybeMessageActionDrawerManager>
          </SearchHighlightTermsProvider>
        </StaticMarkdownContext>
      </DebugSuspense>
    </EntityLoadGate>
  );
}
