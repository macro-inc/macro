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
import { ChannelInput, createInputAttachmentTracker } from '../Input';
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
import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import { createTargetMessageController } from './create-target-message-controller';
import { DebugGoToMessage } from './DebugGoToMessage';

type ChannelProps = {
  channelId: string;
  targetMessageId?: string | undefined;
  lastViewedAt?: DateValue | null;
  debug?: boolean;
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
    debug: () => props.debug === true,
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
          <Show when={props.debug}>
            <DebugGoToMessage
              onSubmit={(messageId) => {
                targetMessageController.goToMessage(messageId);
              }}
            />
          </Show>
          <Show when={messages().length > 0}>
            <div class="relative flex-1 min-h-0">
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
            <div class="pb-2 w-full flex justify-center">
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
                onSend={onSend}
              />
            </div>
          </Suspense>
        </ChannelDropZone>
      </StaticMarkdownContext>
    </Suspense>
  );
}
