import {
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
  type ThreadListScrollTarget,
} from './ThreadList';
import type { ApiChannelMessage } from '@service-comms/client';
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
import { Thread, ThreadRow } from './Thread';
import { createChannelMessageActions } from './create-channel-message-actions';

type ChannelProps = {
  channelId: string;
  targetMessageId?: string | undefined;
  lastViewedAt?: DateValue | null;
};

export function flattenMessages(
  data: ChannelMessagesData | undefined
): ApiChannelMessage[] {
  if (!data?.pages?.length) return [];
  const all: ApiChannelMessage[] = [];
  for (let i = data.pages.length - 1; i >= 0; i--) {
    const items = data.pages[i].items;
    for (let j = items.length - 1; j >= 0; j--) {
      all.push(items[j]);
    }
  }
  return all;
}

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
  const [, setThreadListNavigation] = createSignal<ThreadListNavigation>();
  const [newMessagesDismissed, setNewMessagesDismissed] = createSignal(false);

  const threadManager = createThreadManager();
  const threadPaginator = createThreadPaginator(messagesQuery);

  const threadListInitialScrollTarget: Accessor<ThreadListScrollTarget> = () =>
    defaultThreadListTargetFromMessage(targetMessageId());

  const messages = () =>
    messagesQuery.data
      ? flattenMessages(messagesQuery.data as ChannelMessagesData)
      : [];

  const shift = () => threadPaginator.isShifting();

  const lastViewedAt = createMemo<DateValue | null | undefined>((prev) => {
    if (prev !== undefined) return prev;
    return props.lastViewedAt;
  });
  const openedChannelAt = createMemo<Date>((prev) => prev ?? new Date());

  const isNewMessage = (message: ApiChannelMessage) => {
    if (newMessagesDismissed()) return false;

    const lastViewed = lastViewedAt();
    if (!lastViewed) return false;

    const openedAt = openedChannelAt();
    const createdAt = new Date(message.created_at);

    return (
      createdAt > new Date(lastViewed) &&
      createdAt < openedAt &&
      userId() !== message.sender_id
    );
  };

  const listMetaByMessageId = createMemo(() =>
    buildChannelMessageListMeta(messages(), isNewMessage)
  );
  const dismissNewMessages = () => {
    setNewMessagesDismissed(true);
  };
  const getMessageActions = createChannelMessageActions({
    channelId: () => props.channelId,
    userId,
    patchMessage: patchMessageMutation.mutate,
    deleteMessage: deleteMessageMutation.mutate,
    addReaction: addReactionMutation.mutate,
    removeReaction: removeReactionMutation.mutate,
  });

  return (
    <Suspense>
      <Show when={messages().length > 0}>
        <StaticMarkdownContext>
          <ThreadList
            data={messages}
            initialScrollTarget={threadListInitialScrollTarget()}
            shift={shift}
            onScrollNearTop={threadPaginator.shiftPaginate}
            onScrollNearBottom={threadPaginator.prependPaginate}
            onNavigationReady={setThreadListNavigation}
          >
            {(item) => {
              const state = threadManager.getOrCreateThreadState(item.id);
              return (
                <ThreadRow
                  message={item}
                  listMeta={listMetaByMessageId()[item.id]}
                  onDismissNewMessages={dismissNewMessages}
                >
                  <Thread
                    data={() => item}
                    channelId={() => props.channelId}
                    getMessageActions={getMessageActions}
                    isExpanded={state.isExpanded}
                    setIsExpanded={state.setIsExpanded}
                  />
                </ThreadRow>
              );
            }}
          </ThreadList>
        </StaticMarkdownContext>
      </Show>
    </Suspense>
  );
}
