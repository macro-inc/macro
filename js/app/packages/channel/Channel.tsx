import {
  useChannelMessagesQuery,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import {
  createEffect,
  createSignal,
  on,
  Show,
  Suspense,
  type ParentProps,
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
import { createThreadPaginator } from './thread-paginator';
import { createTargetMessageControlledSignal } from './target-message';

type ChannelProps = {
  channelId: string;
  targetMessageId: string | undefined;
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

  const threadManager = createThreadManager();
  const threadPaginator = createThreadPaginator(messagesQuery);

  const threadListInitialScrollTarget = (): ThreadListScrollTarget => {
    const targetMessageId_ = targetMessageId();
    if (targetMessageId_) {
      return {
        tag: 'id',
        id: targetMessageId_,
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
