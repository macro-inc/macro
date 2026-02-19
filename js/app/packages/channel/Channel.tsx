import {
  useChannelMessagesQuery,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import { createSignal, Show, Suspense, type ParentProps } from 'solid-js';
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
import { createThreadPaginator } from './thread-paginator';

type ChannelProps = {
  channelId: string;
  targetMessageId: string;
};

function ThreadRow(props: ParentProps) {
  return (
    <div class="w-full flex justify-center ">
      <div class="macro-message-width w-full">{props.children}</div>
    </div>
  );
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
  const [, setThreadListNavigation] = createSignal<ThreadListNavigation>();

  const threadManager = createThreadManager();
  const threadPaginator = createThreadPaginator(messagesQuery);

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

  return (
    <Suspense>
      <Show when={messages().length > 0}>
        <StaticMarkdownContext>
          <ThreadList
            data={messages}
            initialScrollTarget={threadListInitialScrollTarget()}
            shift={threadPaginator.isShifting}
            onScrollNearTop={threadPaginator.shiftPaginate}
            onNavigationReady={setThreadListNavigation}
          >
            {(item) => {
              const state = threadManager.getOrCreateThreadState(item.id);
              return (
                <ThreadRow>
                  <Thread
                    data={() => item}
                    channelId={() => props.channelId}
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
