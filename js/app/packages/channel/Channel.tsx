import {
  useChannelMessagesQuery,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import {
  createSignal,
  Show,
  Suspense,
  type ParentProps,
  type Setter,
} from 'solid-js';
import { Thread } from './Thread';
import {
  DEFAULT_INITIAL_SCROLL_TARGET,
  ThreadList,
  type ThreadListNavigation,
  type ThreadListScrollTarget,
} from './ThreadList';
import type { ApiChannelMessage } from '@service-comms/client';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createThreadManager } from './thread-manager';

type ChannelProps = {
  channelId: string;
  targetMessageId: string;
};

function Row(props: ParentProps) {
  return <div class="w-full flex justify-center">{props.children}</div>;
}

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
  const [pendingTopFetch, setPendingTopFetch] = createSignal(false);
  const [, setThreadListNavigation] = createSignal<ThreadListNavigation>();
  const threadManager = createThreadManager();

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
    if (messagesQuery.isFetchingNextPage || isPrepending()) {
      setPendingTopFetch(true);
      return;
    }

    setIsPrepending(true);
    try {
      do {
        setPendingTopFetch(false);
        await messagesQuery.fetchNextPage();
      } while (messagesQuery.hasNextPage && pendingTopFetch());
    } finally {
      setIsPrepending(false);
      setPendingTopFetch(false);
    }
  };

  return (
    <Suspense>
      <Show when={messages().length > 0}>
        <StaticMarkdownContext>
          <ThreadList
            data={messages}
            initialScrollTarget={threadListInitialScrollTarget()}
            shift={isPrepending}
            onScrollNearTop={fetchMoreNearTop}
            onNavigationReady={setThreadListNavigation}
          >
            {(item) => {
              const state = threadManager.getOrCreateThreadState(item.id);
              return (
                <Row>
                  <div class="macro-message-width w-full">
                    <Thread
                      data={() => item}
                      channelId={() => props.channelId}
                      isExpanded={state.isExpanded}
                      setIsExpanded={state.setIsExpanded}
                    />
                  </div>
                </Row>
              );
            }}
          </ThreadList>
        </StaticMarkdownContext>
      </Show>
    </Suspense>
  );
}
