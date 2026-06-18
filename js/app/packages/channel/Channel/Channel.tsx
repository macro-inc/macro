import { openChatWithInput } from '@app/component/ChatWithAgentButton';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { createActivityTracker } from '@channel/activity-tracker';
import { DebugSuspense } from '@channel/DebugSuspense';
import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '@channel/Input/utils/persistence';
import { SearchHighlightTermsProvider } from '@channel/Message';
import { MaybeMessageActionDrawerManager } from '@channel/Mobile/MessageActionDrawerManager';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { FindBar } from '@core/component/FindBar';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { useChannelActivity, useChannelName } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import type { DateValue } from '@core/util/date';
import {
  extractUserMentions,
  trimEdgeUserMentions,
} from '@core/util/taskExtraction';
import { buildMentionMarkdownString, markdownToPlainText } from '@lexical-core';
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
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
import { queryClient } from '@queries/client';
import { useBeforeLeave } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  ChannelInput,
  createInputAttachmentTracker,
  type InputHandle,
  type InputSnapshot,
} from '../Input';
import { ChannelInputContainer } from '../Input/ChannelInputContainer';
import { hasSendableInputContent } from '../Input/utils/sendable-content';
import { ChannelThread } from '../Thread';
import { buildQuoteReplyValue } from '../Thread/utils/message-actions';
import { ActiveCallMessage } from './ActiveCallMessage';
import { ChannelDropZone } from './ChannelDropZone';
import { createChannelDragState } from './create-channel-drag-state';
import { createChannelFindBar } from './create-channel-find-bar';
import { createChannelHotkeys } from './create-channel-hotkeys';
import { createChannelMessageActions } from './create-channel-message-actions';
import { createInlineInputKeyboardHandler } from './create-inline-input-keyboard-handler';
import { createMainInputKeyboardHandler } from './create-main-input-keyboard-handler';
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
  type ThreadListScrollState,
  type ThreadListScrollTarget,
} from './ThreadList';
import { createThreadManager } from './thread-manager';
import { createThreadPaginator } from './thread-paginator';

export type ChannelProps = {
  channelId: string;
  targetMessageId?: string | undefined;
  targetMessageReplyId?: string | undefined;
  lastViewedAt?: DateValue | null;
  onHandleReady?: (handle: ChannelHandle) => void;
  /** Whether to auto-focus the channel input on mount. Defaults to `!isMobile()`. */
  autofocus?: boolean;
};

export type ChannelHandle = {
  goToMessage: TargetMessageController['goToMessage'];
};

export function Channel(props: ChannelProps) {
  const userId = useUserId();

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
  const [messageListElement, setMessageListElement] =
    createSignal<HTMLDivElement>();

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

  const participants = useChannelParticipants(() => props.channelId);

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

  const threadManager = createThreadManager();
  const [isChannelInputHidden, setIsChannelInputHidden] = createSignal(false);
  const [channelInputEl, setChannelInputEl] = createSignal<HTMLDivElement>();
  const threadPaginator = createThreadPaginator(messagesQuery);
  const messageEditor = createMessageEditor({
    channelId: () => props.channelId,
    participantIds: () => participants.ids(),
    patchMessage: patchMessageMutation.mutate,
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
    buildChannelMessageListMeta(messages(), activityTracker.isNewMessage)
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
  const { popoverSplit } = useSplitLayout();

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

  const openReplyInput = (message: {
    id: string;
    thread_id?: string | null;
  }) => {
    const threadId = message.thread_id ?? message.id;
    const state = threadManager.getOrCreateThreadState(threadId);
    state.setIsReplying(true);
    return state;
  };

  const openQuoteReplyInput = (message: {
    id: string;
    content: string;
    thread_id?: string | null;
  }) => {
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
    state.setIsReplying(true);
    requestAnimationFrame(() => {
      state.replyInputHandle?.()?.restoreSnapshot(nextSnapshot);
    });
  };

  const getMessageActions = createChannelMessageActions({
    channelId: () => props.channelId,
    userId,
    deleteMessage: deleteMessageMutation.mutate,
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
    } else {
      selectMessage(messageId);
    }
    targetMessageController.goToMessage(messageId, replyId);
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

  // On Mobile when a thread reply input is focused, we want to hide the main Channel input
  createInlineInputKeyboardHandler(messageListElement, setIsChannelInputHidden);
  // On Native iOS app, when the main channel input is focused, scroll to bottom if already near bottom
  createMainInputKeyboardHandler(
    channelInputEl,
    threadListNavigation,
    messageListElement
  );

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
        });
    })
  );

  return (
    <DebugSuspense name="Channel.root">
      <StaticMarkdownContext>
        <SearchHighlightTermsProvider value={findBar.getSearchTermsForMessage}>
          <MaybeMessageActionDrawerManager>
            <ChannelDropZone dragState={dragState}>
              <div
                class="ph-no-capture relative flex-1 min-h-0 outline-none flex flex-col"
                ref={(element) => {
                  setMessageListElement(element);
                  attachMessageListRef(element);
                }}
                tabIndex={-1}
                data-channel-message-list
              >
                <Show when={findBar.isOpen()}>
                  <FindBar
                    class="absolute top-2 right-3 z-10 w-80 max-w-[calc(100%-1.5rem)]"
                    controller={findBar}
                    direction="desc"
                  />
                </Show>
                <Show when={messages().length > 0}>
                  <div class="relative flex-1 min-h-0">
                    <ThreadList
                      keys={() => messageIndex.keys}
                      initialScrollTarget={threadListInitialScrollTarget()}
                      shift={shift}
                      prepend={threadPaginator.isPrepending}
                      onScrollNearTop={threadPaginator.shiftPaginate}
                      onScrollNearBottom={threadPaginator.prependPaginate}
                      onNavigationReady={setThreadListNavigation}
                      onScrollStateChange={setThreadListScrollState}
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
                                targetThreadId={targetMessageController.activeTargetMessageId()}
                                targetReplyId={targetMessageController.pendingTargetReplyId()}
                                selectedReplyId={targetMessageController.activeTargetMessageReplyId()}
                                onTargetReplyScrolled={(replyId) => {
                                  targetMessageController.completePendingReplyScroll(
                                    m().id,
                                    replyId
                                  );
                                }}
                                isExpanded={state.isExpanded}
                                setIsExpanded={state.setIsExpanded}
                                isReplying={state.isReplying}
                                setIsReplying={state.setIsReplying}
                                replyInputState={state.replyInputState}
                                setReplyInputState={state.setReplyInputState}
                                setReplyInputEl={state.setReplyInputEl}
                                setReplyInputHandle={state.setReplyInputHandle}
                                listMeta={listMetaByMessageId()[item.id]}
                                messageEditor={messageEditor}
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
                    <Show when={!findBar.isOpen()}>
                      <ScrollToBottomOverlay
                        scrollState={threadListScrollState}
                        onScrollToBottom={handleScrollToBottom}
                      />
                    </Show>
                  </div>
                </Show>
                <ActiveCallMessage channelId={props.channelId} />
              </div>
              <DebugSuspense name="Channel.input">
                <ChannelInputContainer
                  ref={(el) => {
                    attachInputRef(el);
                    setChannelInputEl(el);
                  }}
                  isHidden={isChannelInputHidden()}
                >
                  <ChannelInput
                    autofocus={props.autofocus}
                    collapsible
                    input={{
                      mode: 'channel',
                      id: `channel-input-${props.channelId}`,
                      placeholder: 'Message channel',
                      isDraggingOverChannel: dragState.isDraggingOverChannel(),
                      isValidChannelDrag: dragState.isValidChannelDrag(),
                    }}
                    participants={participants.users}
                    attachmentTracker={attachmentTracker}
                    persistenceKey={makeInputValuePersistenceKey({
                      channelId: props.channelId,
                    })}
                    onReady={(handle) => {
                      dragState.setAttachFilesToChannel(handle.attachFiles);
                      dragState.setEntityMentionInputHandlers(handle);
                      setChannelInputHandle(handle);
                    }}
                    onChange={(snapshot) =>
                      void setChannelInputSnapshot(snapshot)
                    }
                    onSend={onSend}
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
                </ChannelInputContainer>
              </DebugSuspense>
            </ChannelDropZone>
          </MaybeMessageActionDrawerManager>
        </SearchHighlightTermsProvider>
      </StaticMarkdownContext>
    </DebugSuspense>
  );
}
