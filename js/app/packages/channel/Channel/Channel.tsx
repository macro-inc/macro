import {
  flattenMessages,
  useChannelMessagesQuery,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import {
  createMemo,
  createSignal,
  Show,
  Suspense,
  type Accessor,
} from 'solid-js';
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
import { createTargetMessageControlledSignal } from './target-message';
import { useUserId } from '@core/context/user';
import {
  useDeleteMessageMutation,
  usePatchMessageMutation,
} from '@queries/channel/message';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/channel/reaction';
import type { DateValue } from '@core/util/date';
import { buildChannelMessageListMeta } from './message-list-meta';
import { ScrollToBottomOverlay } from './ScrollToBottomOverlay';
import { ChannelThread } from '../Thread';
import { ChannelInput } from '../Input';
import { createChannelMessageActions } from './create-channel-message-actions';
import { createActivityTracker } from '@channel/activity-tracker';
import { useChannelActivity } from '@core/context/channels';
import { createChannelDragState } from './create-channel-drag-state';
import { ChannelDropZone } from './ChannelDropZone';

type ChannelProps = {
  channelId: string;
  targetMessageId?: string | undefined;
  lastViewedAt?: DateValue | null;
};

export function Channel(props: ChannelProps) {
  const userId = useUserId();
  const patchMessageMutation = usePatchMessageMutation();
  const deleteMessageMutation = useDeleteMessageMutation();
  const addReactionMutation = useAddReactionMutation();
  const removeReactionMutation = useRemoveReactionMutation();
  const [targetMessageId, _setTargetMessageId] =
    createTargetMessageControlledSignal(
      () => props.channelId,
      props.targetMessageId
    );

  const messagesQuery = useChannelMessagesQuery(
    () => props.channelId,
    targetMessageId
  );

  const activity = useChannelActivity(props.channelId);

  const [threadListNavigation, setThreadListNavigation] =
    createSignal<ThreadListNavigation>();
  const [threadListScrollState, setThreadListScrollState] =
    createSignal<ThreadListScrollState>();

  const threadManager = createThreadManager();
  const threadPaginator = createThreadPaginator(messagesQuery);

  const threadListInitialScrollTarget: Accessor<ThreadListScrollTarget> = () =>
    defaultThreadListTargetFromMessage(targetMessageId());

  const messages = () =>
    messagesQuery.data
      ? flattenMessages(messagesQuery.data as ChannelMessagesData)
      : [];

  const shift = () => threadPaginator.isShifting();

  const activityTracker = createActivityTracker({
    lastViewedAt: () => activity().viewed_at,
    userId,
  });

  const listMetaByMessageId = createMemo(() =>
    buildChannelMessageListMeta(messages(), activityTracker.isNewMessage)
  );

  const dragState = createChannelDragState({
    channelId: props.channelId,
  });

  const getMessageActions = createChannelMessageActions({
    channelId: () => props.channelId,
    userId,
    patchMessage: patchMessageMutation.mutate,
    deleteMessage: deleteMessageMutation.mutate,
    addReaction: addReactionMutation.mutate,
    removeReaction: removeReactionMutation.mutate,
    onReply: (ctx) => {
      const state = threadManager.getOrCreateThreadState(ctx.message.id);
      state.setIsReplying(true);
    },
  });

  return (
    <Suspense>
      <StaticMarkdownContext>
        <ChannelDropZone dragState={dragState}>
          <Show when={messages().length > 0}>
            <div class="relative flex-1 min-h-0">
              <ThreadList
                data={messages}
                initialScrollTarget={threadListInitialScrollTarget()}
                shift={shift}
                onScrollNearTop={threadPaginator.shiftPaginate}
                onScrollNearBottom={threadPaginator.prependPaginate}
                onNavigationReady={setThreadListNavigation}
                onScrollStateChange={setThreadListScrollState}
              >
                {(item) => {
                  const state = threadManager.getOrCreateThreadState(item.id);
                  return (
                    <ChannelThread
                      data={() => item}
                      channelId={() => props.channelId}
                      getMessageActions={getMessageActions}
                      isExpanded={state.isExpanded}
                      setIsExpanded={state.setIsExpanded}
                      isReplying={state.isReplying}
                      setIsReplying={state.setIsReplying}
                      replyInputState={state.replyInputState}
                      setReplyInputState={state.setReplyInputState}
                      listMeta={listMetaByMessageId()[item.id]}
                      threadActions={{
                        onDismissNewMessages:
                          activityTracker.dismissNewMessages,
                      }}
                    />
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
                attachmentTracker={dragState.tracker}
                onReady={(handle) => {
                  dragState.setAttachFilesToChannel(handle.attachFiles);
                }}
              />
            </div>
          </Suspense>
        </ChannelDropZone>
      </StaticMarkdownContext>
    </Suspense>
  );
}
