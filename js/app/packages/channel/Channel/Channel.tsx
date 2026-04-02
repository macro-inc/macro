import {
  makeMessageIndex,
  type ChannelMessagesData,
  useChannelMessagesQuery,
} from '@queries/channel/channel-messages';
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
  type InputSnapshot,
} from '../Input';
import { ChannelInputContainer } from '../Input/ChannelInputContainer';
import { createChannelMessageActions } from './create-channel-message-actions';
import { createActivityTracker } from '@channel/activity-tracker';
import { useChannelActivity } from '@core/context/channels';
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
import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import {
  createTargetMessageController,
  type TargetMessageController,
} from './create-target-message-controller';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/channel/reaction';
import { resetKeyboardModality } from './util';
import { focusAndOpenKeyboard } from '@core/mobile/focus-and-open-keyboard';
import { isMobile } from '@core/mobile/isMobile';
import { DebugSuspense } from '@channel/DebugSuspense';
import { MaybeMessageActionDrawerManager } from '@channel/Mobile/MessageActionDrawerManager';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
import {
  scrollReplyInputAboveKeyboard,
  scrollReplyInputIntoView,
} from '../scroll-utils';

type ChannelProps = {
  channelId: string;
  targetMessageId?: string | undefined;
  targetMessageReplyId?: string | undefined;
  lastViewedAt?: DateValue | null;
  onHandleReady?: (handle: ChannelHandle) => void;
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
  let messageListElement: HTMLDivElement | undefined;

  const targetMessageController = createTargetMessageController({
    channelId: () => props.channelId,
    initialTargetMessageId: props.targetMessageId,
    initialTargetMessageReplyId: props.targetMessageReplyId,
    messageKeys: () => messageIndex().keys,
    navigation: threadListNavigation,
  });

  const [channelInputSnapshot, setChannelInputSnapshot] =
    createSignal<InputSnapshot>();

  const messagesQuery = useChannelMessagesQuery(
    () => props.channelId,
    targetMessageController.loadAroundMessageId
  );
  const messageIndex = createMemo(() =>
    makeMessageIndex(messagesQuery.data as ChannelMessagesData | undefined)
  );
  const messages = createMemo(() => messageIndex().items);
  const messageById = createMemo(() => messageIndex().byId);

  const participants = useChannelParticipants(() => props.channelId);

  const activity = useChannelActivity(props.channelId);

  const updateActivityMutation = useUpdateChannelsActivityMutation({
    onSuccess: () => {
      invalidateChannelsActivity();
    },
  });

  onMount(() => {
    updateActivityMutation.mutate({
      channelId: props.channelId,
      activityType: 'view',
    });
  });

  useBeforeLeave(() => {
    updateActivityMutation.mutate({
      channelId: props.channelId,
      activityType: 'view',
    });
  });

  const threadManager = createThreadManager();
  const [isChannelInputHidden, setIsChannelInputHidden] = createSignal(false);
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

  const getMessageActions = createChannelMessageActions({
    channelId: () => props.channelId,
    userId,
    deleteMessage: deleteMessageMutation.mutate,
    addReaction: addReactionMutation.mutate,
    removeReaction: removeReactionMutation.mutate,
    onReply: (ctx) => {
      const state = threadManager.getOrCreateThreadState(ctx.message.id);
      focusAndOpenKeyboard(
        () =>
          document.querySelector(
            `[data-input-id="thread-reply-input-${ctx.message.id}"] [contenteditable]`
          ) as HTMLElement | null,
        ctx.event?.target as HTMLElement | undefined
      );
      state.setIsReplying(true);
      requestAnimationFrame(() => scrollReplyInputIntoView(ctx.message.id));
    },
    onEdit: ({ message }) => {
      messageEditor.start(message);
    },
  });

  const selection = createMessageSelection({
    keys: () => messageIndex().keys,
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
    });

  createStickyScrollEffect({
    isNearBottom: () => threadListScrollState()?.isNearBottom ?? false,
    hasMoreBelow: () => threadPaginator.hasMorePrepend(),
    messages,
    scrollToBottom: () => threadListNavigation()?.scrollToBottom(),
  });

  const onSend: ChannelInputProps['onSend'] = (snapshot) => {
    const senderId = userId();
    if (!senderId) return;

    sendMessageMutation.mutate({
      channelID: props.channelId,
      senderId,
      optimisticId: crypto.randomUUID(),
      message: buildPostMessageRequest({
        snapshot,
        participantIds: participants.ids(),
      }),
    });
  };

  const isChannelReady = () => {
    return (
      messagesQuery.isFetched &&
      threadListNavigation() &&
      threadListScrollState()?.didInitialScroll
    );
  };

  const goToMessage: ChannelHandle['goToMessage'] = (messageId, replyId) => {
    if (messageListElement) {
      resetKeyboardModality(messageListElement);
    }
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
            <Show when={messages().length > 0}>
              <div
                class="ph-no-capture relative flex-1 min-h-0 suppress-css-brackets suppress-css-bracket outline-none"
                ref={(element) => {
                  messageListElement = element;
                  attachMessageListRef(element);
                }}
                tabIndex={-1}
                data-channel-message-list
                data-channel-nav="keyboard"
                onMouseMove={(e) => {
                  const el = e.currentTarget;
                  if (el.dataset.channelNav !== 'mouse') {
                    el.dataset.channelNav = 'mouse';
                  }
                }}
              >
                <ThreadList
                  keys={() => messageIndex().keys}
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
                      item.id === messageIndex().keys.at(-1);

                    if (isMobile()) {
                      createEffect(() => {
                        const el = state.replyInputEl?.();
                        if (!el) return;

                        let keyboardWillShowHandler:
                          | ((e: Event) => void)
                          | undefined;

                        const handleFocusIn = () => {
                          setIsChannelInputHidden(true);
                          const currentKeyboardHeight = parseFloat(
                            getComputedStyle(
                              document.documentElement
                            ).getPropertyValue('--virtual-keyboard-height')
                          );
                          if (currentKeyboardHeight > 0) {
                            scrollReplyInputAboveKeyboard(
                              item.id,
                              currentKeyboardHeight
                            );
                          } else {
                            keyboardWillShowHandler = (event: Event) => {
                              const height =
                                (event as CustomEvent<{ height: number }>)
                                  .detail?.height ?? 0;
                              scrollReplyInputAboveKeyboard(item.id, height);
                              keyboardWillShowHandler = undefined;
                            };
                            window.addEventListener(
                              'keyboardWillShow',
                              keyboardWillShowHandler,
                              { once: true }
                            );
                          }
                        };

                        const handleFocusOut = (e: FocusEvent) => {
                          if (!el.contains(e.relatedTarget as Node)) {
                            setIsChannelInputHidden(false);
                            if (keyboardWillShowHandler) {
                              window.removeEventListener(
                                'keyboardWillShow',
                                keyboardWillShowHandler
                              );
                              keyboardWillShowHandler = undefined;
                            }
                          }
                        };

                        el.addEventListener('focusin', handleFocusIn);
                        el.addEventListener(
                          'focusout',
                          handleFocusOut as EventListener
                        );
                        onCleanup(() => {
                          el.removeEventListener('focusin', handleFocusIn);
                          el.removeEventListener(
                            'focusout',
                            handleFocusOut as EventListener
                          );
                          if (keyboardWillShowHandler) {
                            window.removeEventListener(
                              'keyboardWillShow',
                              keyboardWillShowHandler
                            );
                          }
                        });
                      });
                    }
                    return (
                      <Show when={message()}>
                        {(m) => (
                          <ChannelThread
                            data={m}
                            channelId={() => props.channelId}
                            isNewestThread={isNewestThread()}
                            getMessageActions={getMessageActions}
                            targetReplyId={targetMessageController.pendingTargetReplyId()}
                            highlightedReplyId={targetMessageController.activeTargetMessageReplyId()}
                            onTargetReplyScrolled={(replyId) => {
                              targetMessageController.completePendingReplyScroll(
                                m().id,
                                replyId
                              );
                            }}
                            highlighted={
                              m().id ===
                              targetMessageController.highlightedMessageId()
                            }
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
                            messageListScopeId={messageListScopeId}
                          />
                        )}
                      </Show>
                    );
                  }}
                </ThreadList>
                <ScrollToBottomOverlay
                  navigation={threadListNavigation}
                  scrollState={threadListScrollState}
                />
              </div>
            </Show>
            <DebugSuspense name="Channel.input">
              <ChannelInputContainer
                ref={attachInputRef}
                isHidden={isChannelInputHidden()}
              >
                <ChannelInput
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
