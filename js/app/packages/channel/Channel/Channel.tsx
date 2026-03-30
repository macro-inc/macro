import {
  makeMessageIndex,
  type ChannelMessagesData,
  useChannelMessagesQuery,
} from '@queries/channel/channel-messages';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onMount,
  Switch,
  type Accessor,
} from 'solid-js';
import { useBeforeLeave } from '@solidjs/router';
import {
  defaultThreadListTargetFromMessage,
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
import { createInputAttachmentTracker, type InputSnapshot } from '../Input';
import { createChannelMessageActions } from './create-channel-message-actions';
import { createActivityTracker } from '@channel/activity-tracker';
import { useChannelActivity } from '@core/context/channels';
import {
  invalidateChannelsActivity,
  useUpdateChannelsActivityMutation,
} from '@queries/channel/activity';
import { createChannelDragState } from './create-channel-drag-state';
import { buildPostMessageRequest } from '@channel/Input/message-payload';
import { makeAttachmentTrackerPersistenceKey } from '@channel/Input/utils/persistence';
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
import { DebugSuspense } from '@channel/DebugSuspense';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
import { DEFAULT_CHANNEL_TAB, type ChannelTabId } from './channel-tabs';
import { ChannelMessagesTab } from './ChannelMessagesTab';
import { ChannelAttachmentsTab } from './ChannelAttachmentsTab';
import { ChannelTabPlaceholder } from './ChannelTabPlaceholder';

type ChannelProps = {
  channelId: string;
  activeTab?: ChannelTabId;
  onTabChange?: (value: ChannelTabId) => void;
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
  const activeTab = () => props.activeTab ?? DEFAULT_CHANNEL_TAB;

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
    props.onTabChange?.(DEFAULT_CHANNEL_TAB);
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
        <Switch>
          <Match when={activeTab() === 'messages'}>
            <ChannelMessagesTab
              channelId={props.channelId}
              messageIndexKeys={() => messageIndex().keys}
              messageById={messageById}
              initialScrollTarget={threadListInitialScrollTarget()}
              shift={shift}
              isPrepending={threadPaginator.isPrepending}
              onScrollNearTop={threadPaginator.shiftPaginate}
              onScrollNearBottom={threadPaginator.prependPaginate}
              onNavigationReady={setThreadListNavigation}
              onScrollStateChange={setThreadListScrollState}
              threadListNavigation={threadListNavigation}
              threadListScrollState={threadListScrollState}
              threadManager={threadManager}
              listMetaByMessageId={listMetaByMessageId}
              getMessageActions={getMessageActions}
              pendingTargetReplyId={
                targetMessageController.pendingTargetReplyId
              }
              activeTargetMessageReplyId={
                targetMessageController.activeTargetMessageReplyId
              }
              completePendingReplyScroll={
                targetMessageController.completePendingReplyScroll
              }
              highlightedMessageId={
                targetMessageController.highlightedMessageId
              }
              messageEditor={messageEditor}
              dismissNewMessages={activityTracker.dismissNewMessages}
              isNewMessage={activityTracker.isNewMessage}
              selectedMessageId={selection.selectedId}
              messageListScopeId={messageListScopeId}
              dragState={dragState}
              attachMessageListRef={(element) => {
                messageListElement = element;
                attachMessageListRef(element);
              }}
              attachInputRef={attachInputRef}
              attachmentTracker={attachmentTracker}
              participants={participants.users}
              onInputReady={(handle) => {
                dragState.setAttachFilesToChannel(handle.attachFiles);
              }}
              onInputChange={(snapshot) =>
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
          </Match>
          <Match when={activeTab() === 'attachments'}>
            <ChannelAttachmentsTab />
          </Match>
          <Match when={activeTab() === 'participants'}>
            <ChannelTabPlaceholder label="Participants" />
          </Match>
          <Match when={activeTab() === 'new'}>
            <ChannelTabPlaceholder label="New" />
          </Match>
        </Switch>
      </StaticMarkdownContext>
    </DebugSuspense>
  );
}
