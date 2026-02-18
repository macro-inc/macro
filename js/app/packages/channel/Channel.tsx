import {
  useChannelMessagesQuery,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import { createEffect, createSignal, Show, Suspense } from 'solid-js';
import { ThreadList } from './ThreadList';
import type { ApiChannelMessage } from '@service-comms/client';
import type { ApiThreadInfo } from '@service-storage/generated/schemas';

type ChannelProps = {
  channelId: string;
};

type Message = Omit<ApiChannelMessage, 'thread'>;

type RenderedThread = {
  message: Message;
  expanded: boolean;
} & ApiThreadInfo;

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
  const messages = () =>
    messagesQuery.data
      ? flattenMessages(messagesQuery.data as ChannelMessagesData)
      : [];

  const fetchMoreNearTop = () => {
    if (messagesQuery.hasNextPage) {
      setIsPrepending(true);
      const result = messagesQuery.fetchNextPage();
      result.finally(() => {
        setIsPrepending(false);
      });
    }
  };

  createEffect(() => {
    messages();
    setIsPrepending(false);
  });

  return (
    <Suspense>
      <Show when={messages().length > 0}>
        <ThreadList
          data={messages}
          initialListPosition={{ tag: 'end' }}
          isPrepending={isPrepending}
          onScrollNearTop={fetchMoreNearTop}
        >
          {(item) => {
            return <p>{item.content}</p>;
          }}
        </ThreadList>
      </Show>
    </Suspense>
  );
}
