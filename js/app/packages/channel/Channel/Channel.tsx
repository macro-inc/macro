import {
  makeMessageIndex,
  type ChannelMessagesData,
  useChannelMessagesQuery,
} from '@queries/channel/channel-messages';
import {
  createMemo,
  createSignal,
  onMount,
  Show,
  Suspense,
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
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/channel/reaction';
import type { DateValue } from '@core/util/date';
import { buildChannelMessageListMeta } from './message-list-meta';
import { ScrollToBottomOverlay } from './ScrollToBottomOverlay';
import { ChannelThread } from '../Thread';
import {
  ChannelInput,
  createInputAttachmentTracker,
  type InputSnapshot,
} from '../Input';
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
import { createTargetMessageController } from './create-target-message-controller';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { URL_PARAMS } from '@block-channel/constants';

type ChannelProps = {
  channelId: string;
  targetMessageId?: string | undefined;
  targetMessageReplyId?: string | undefined;
  lastViewedAt?: DateValue | null;
};

export function Channel(props: ChannelProps) {
  const userId = useUserId();
  const sendMessageMutation = useSendMessageMutation();
  const patchMessageMutation = usePatchMessageMutation();
  const deleteMessageMutation = useDeleteMessageMutation();
  const addReactionMutation = useAddReactionMutation();
  const removeReactionMutation = useRemoveReactionMutation();
  const [threadListNavigation, setThreadListNavigation] =
    createSignal<ThreadListNavigation>();
  const [threadListScrollState, setThreadListScrollState] =
    createSignal<ThreadListScrollState>();

  const targetMessageController = createTargetMessageController({
    channelId: () => props.channelId,
    initialTargetMessageId: props.targetMessageId,
    messageKeys: () => messageIndex().keys,
    navigation: threadListNavigation,
  });

  // START BLOCK COMPATIBILITY
  const blockHandle = blockHandleSignal.get;
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      const threadId = params[URL_PARAMS.thread] as string | undefined;
      const messageId = params[URL_PARAMS.message] as string | undefined;

      // For compotibility the naming is  a little strange here.
      // New channels index by top level message and then spertately handle replies.
      // If we have a threadId that is actually the top level message and the reply is the message id.
      const topLevelMessageId = threadId ? threadId : messageId;
      const messageReplyId = threadId ? messageId : threadId;

      if (topLevelMessageId) {
        targetMessageController.goToMessage(topLevelMessageId, messageReplyId);
      }
    },
  });
  // END BLOCK COMPATIBILITY

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
      state.setIsReplying(true);
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
      message: buildPostMessageRequest(snapshot),
    });
  };

  return (
    <Suspense>
      <StaticMarkdownContext>
        <ChannelDropZone dragState={dragState}>
          <Show when={messages().length > 0}>
            <div
              class="relative flex-1 min-h-0 suppress-css-brackets suppress-css-bracket outline-none"
              ref={attachMessageListRef}
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
                  return (
                    <Show when={message()}>
                      {(m) => (
                        <ChannelThread
                          data={m}
                          channelId={() => props.channelId}
                          getMessageActions={getMessageActions}
                          targetReplyId={targetMessageController.activeTargetMessageReplyId()}
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
          <Suspense>
            <div class="pb-2 w-full flex justify-center" ref={attachInputRef}>
              <ChannelInput
                input={{
                  mode: 'channel',
                  id: `channel-input-${props.channelId}`,
                  placeholder: 'Message channel',
                  isDraggingOverChannel: dragState.isDraggingOverChannel(),
                  isValidChannelDrag: dragState.isValidChannelDrag(),
                }}
                attachmentTracker={attachmentTracker}
                persistenceKey={makeInputValuePersistenceKey({
                  channelId: props.channelId,
                })}
                onReady={(handle) => {
                  dragState.setAttachFilesToChannel(handle.attachFiles);
                }}
                onChange={(snapshot) => void setChannelInputSnapshot(snapshot)}
                onSend={onSend}
              />
            </div>
          </Suspense>
        </ChannelDropZone>
      </StaticMarkdownContext>
    </Suspense>
  );
}
