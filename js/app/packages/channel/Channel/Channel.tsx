import {
  type ChannelMessagesData,
  useChannelMessagesQuery,
  createMessageIndex,
  getChannelMessagesQueryKey,
} from '@queries/channel/channel-messages';
import { queryClient } from '@queries/client';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  type Accessor,
} from 'solid-js';
import { useBeforeLeave } from '@solidjs/router';
import {
  defaultThreadListTargetFromMessage,
  ThreadList,
  type ThreadListNavigation,
  type ThreadListScrollState,
  type ThreadListScrollTarget,
} from './ThreadList';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createThreadManager } from './thread-manager';
import { createThreadPaginator } from './thread-paginator';
import { useUserId } from '@core/context/user';
import {
  useDeleteMessageMutation,
  usePatchMessageMutation,
  useSendMessageMutation,
} from '@queries/channel/message';
import type { DateValue } from '@core/util/date';
import { buildChannelMessageListMeta } from './message-list-meta';
import { ScrollToBottomOverlay } from './ScrollToBottomOverlay';
import { ChannelThread } from '../Thread';
import {
  ChannelInput,
  createInputAttachmentTracker,
  type InputHandle,
  type InputSnapshot,
} from '../Input';
import { hasSendableInputContent } from '../Input/utils/sendable-content';
import { ChannelInputContainer } from '../Input/ChannelInputContainer';
import { createChannelMessageActions } from './create-channel-message-actions';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { openChatWithInput } from '@app/component/ChatWithAgentButton';
import { useChannelName, useChannelActivity } from '@core/context/channels';
import { buildMentionMarkdownString, markdownToPlainText } from '@lexical-core';
import { extractUserMentions } from '@core/util/taskExtraction';
import { createActivityTracker } from '@channel/activity-tracker';
import {
  invalidateChannelsActivity,
  useUpdateChannelsActivityMutation,
} from '@queries/channel/activity';
import { createChannelDragState } from './create-channel-drag-state';
import { ChannelDropZone } from './ChannelDropZone';
import { buildPostMessageRequest } from '@channel/Input/message-payload';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '@channel/Input/utils/persistence';
import { createStickyScrollEffect } from './sticky-scroll';
import { createMessageEditor } from './create-message-editor';
import { createMessageSelection } from './create-message-selection';
import { createChannelHotkeys } from './create-channel-hotkeys';
import { createInlineInputKeyboardHandler } from './create-inline-input-keyboard-handler';
import { createMainInputKeyboardHandler } from './create-main-input-keyboard-handler';
import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import {
  clearStaleRestoredChannelData,
  createTargetMessageController,
  type TargetMessageController,
} from './create-target-message-controller';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/channel/reaction';
import { DebugSuspense } from '@channel/DebugSuspense';
import { MaybeMessageActionDrawerManager } from '@channel/Mobile/MessageActionDrawerManager';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
import { scrollReplyInputIntoView } from '../scroll-utils';

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
    messageKeys: () => messageIndex.keys,
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
    attachmentTracker,
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

  const getMessageActions = createChannelMessageActions({
    channelId: () => props.channelId,
    userId,
    deleteMessage: deleteMessageMutation.mutate,
    addReaction: addReactionMutation.mutate,
    removeReaction: removeReactionMutation.mutate,
    onReply: (ctx) => {
      const state = threadManager.getOrCreateThreadState(ctx.message.id);
      state.setIsReplying(true);
      requestAnimationFrame(() => scrollReplyInputIntoView(ctx.message.id));
    },
    onEdit: ({ message }) => {
      messageEditor.start(message);
    },
    onCreateTask: (ctx) => {
      const plainText = markdownToPlainText(ctx.message.content).trim();
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

    sendMessageMutation.mutate(
      {
        channelID: props.channelId,
        senderId,
        optimisticId: crypto.randomUUID(),
        message: buildPostMessageRequest({
          snapshot,
          participantIds: participants.ids(),
        }),
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

  const goToMessage: ChannelHandle['goToMessage'] = (messageId, replyId) => {
    selectMessage(messageId);
    targetMessageController.goToMessage(messageId, replyId);
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
        <MaybeMessageActionDrawerManager>
          <ChannelDropZone dragState={dragState}>
            <div
              class="ph-no-capture relative flex-1 min-h-0 suppress-css-brackets suppress-css-bracket outline-none"
              ref={(element) => {
                setMessageListElement(element);
                attachMessageListRef(element);
              }}
              tabIndex={-1}
              data-channel-message-list
            >
              <Show when={messages().length > 0}>
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
                    const state = threadManager.getOrCreateThreadState(item.id);
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
                            targetReplyId={targetMessageController.pendingTargetReplyId()}
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
                <ScrollToBottomOverlay
                  scrollState={threadListScrollState}
                  onScrollToBottom={handleScrollToBottom}
                />
              </Show>
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
      </StaticMarkdownContext>
    </DebugSuspense>
  );
}
