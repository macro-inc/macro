import {
  useChannelMessagesQuery,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import { createSignal, Show, Suspense } from 'solid-js';
import {
  DEFAULT_INITIAL_SCROLL_TARGET,
  ThreadList,
  type ThreadListNavigation,
  type ThreadListScrollTarget,
} from './ThreadList';
import type { ApiChannelMessage } from '@service-comms/client';

type ChannelProps = {
  channelId: string;
  targetMessageId: string;
};

export type ChannelNavigation = {
  navigatePrevious: () => boolean;
  navigateNext: () => boolean;
  navigateToTop: () => boolean;
  navigateToBottom: () => boolean;
  navigateToMessage: (messageId: string) => boolean;
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
  const messagesQuery = useChannelMessagesQuery(() => props.channelId);
  const [isPrepending, setIsPrepending] = createSignal(false);
  const [threadListNavigation, setThreadListNavigation] =
    createSignal<ThreadListNavigation>();

  const threadListInitialScrollTarget = (): ThreadListScrollTarget => {
    if (props.targetMessageId) {
      return {
        tag: 'id',
        id: props.targetMessageId,
      };
    }
    return DEFAULT_INITIAL_SCROLL_TARGET;
  };

  const messages = () =>
    messagesQuery.data
      ? flattenMessages(messagesQuery.data as ChannelMessagesData)
      : [];

  const fetchMoreNearTop = async () => {
    if (!messagesQuery.hasNextPage) return;
    if (messagesQuery.isFetchingNextPage || isPrepending()) return;

    setIsPrepending(true);
    try {
      await messagesQuery.fetchNextPage();
    } finally {
      setIsPrepending(false);
    }
  };

  return (
    <Suspense>
      <Show when={messages().length > 0}>
        <ThreadList
          data={messages}
          initialScrollTarget={threadListInitialScrollTarget()}
          isPrepending={isPrepending}
          onScrollNearTop={fetchMoreNearTop}
          onNavigationReady={setThreadListNavigation}
        >
          {(item) => {
            return <p>{item.content}</p>;
          }}
        </ThreadList>
      </Show>
    </Suspense>
  );
}
