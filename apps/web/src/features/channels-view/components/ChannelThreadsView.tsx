import { ViewShell } from '@app/components/view-shell';
import { MessageThread, threadListItem } from '@core/messages/MessageThread';
import type { ChannelEntity, ChannelThreadEntity } from '@entity';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import { useMessageThreadQuery } from '@queries/messages/thread-replies';
import { Button, cn, Scroll } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { useChannelThreadsQuery } from '../queries/channel-threads';
import { ChannelAvatar } from './rail/ChannelRailItems';

/** Load the next page once the list is within this many pixels of its end. */
const LOAD_MORE_THRESHOLD = 600;
const LIST_SKELETON_CARDS = [0, 1, 2];
/** Reply rows sketched under the root while a card loads, as width classes. */
const CARD_SKELETON_REPLIES = ['w-2/3', 'w-1/2'];
const CARD_CLASS =
  'relative flex flex-col gap-2 rounded-xl border border-edge-muted bg-surface p-3';

/** One sketched message row: avatar, name, and a line of text. */
function MessageSkeleton(props: { textWidth: string; indent?: boolean }) {
  return (
    <div class={cn('flex items-start gap-2', props.indent && 'pl-8')}>
      <div class="skeleton-shimmer size-7 shrink-0 rounded-full bg-skeleton" />
      <div class="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <div class="skeleton-shimmer h-2.5 w-24 rounded-full bg-skeleton" />
        <div
          class={cn(
            'skeleton-shimmer h-2.5 rounded-full bg-skeleton',
            props.textWidth
          )}
        />
      </div>
    </div>
  );
}

/** The body of a card whose thread is still loading: a root and two replies. */
function ThreadSkeleton() {
  return (
    <div aria-hidden="true" class="flex flex-col gap-3">
      <MessageSkeleton textWidth="w-4/5" />
      <For each={CARD_SKELETON_REPLIES}>
        {(width) => <MessageSkeleton textWidth={width} indent />}
      </For>
    </div>
  );
}

function ThreadListSkeleton() {
  return (
    <div role="status" aria-label="Loading threads" class="flex flex-col gap-6">
      <For each={LIST_SKELETON_CARDS}>
        {() => (
          <div class={CARD_CLASS}>
            <ThreadSkeleton />
          </div>
        )}
      </For>
    </div>
  );
}

export type ChannelThreadsViewProps = {
  /** The conversation whose threads are shown; all threads when unset. */
  channelId: string | undefined;
  /** Channel metadata already loaded by the rail, for names and access. */
  resolveChannel: (channelId: string) => ChannelEntity | undefined;
  onOpenThread: (thread: ChannelThreadEntity) => void;
};

function ThreadCard(props: {
  thread: ChannelThreadEntity;
  channel: ChannelEntity | undefined;
  showChannel: boolean;
  onOpen: () => void;
}) {
  const parent = () => ({
    type: 'channel' as const,
    id: props.thread.channelId,
  });
  const query = useMessageThreadQuery(parent, () => props.thread.id);

  return (
    <article class={CARD_CLASS} data-channel-thread={props.thread.id}>
      <Show when={props.showChannel && props.channel}>
        {(channel) => (
          <header class="flex min-w-0 items-center gap-2 text-xs">
            <ChannelAvatar channel={channel()} />
            <span class="min-w-0 truncate font-medium text-ink">
              {channel().name}
            </span>
          </header>
        )}
      </Show>
      <Switch>
        <Match when={query.isError}>
          <div class="flex items-center gap-2 text-xs text-ink-muted">
            <span>Couldn’t load this thread.</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        </Match>
        <Match when={!query.isSuccess}>
          <ThreadSkeleton />
        </Match>
        <Match when={query.isSuccess && !query.data.state.deleted_at}>
          <MessageThread
            data={threadListItem(query.data!)}
            // Channels the rail knows about say whether the viewer can post;
            // anything else is left to the server to refuse.
            canWrite={props.channel?.isParticipant !== false}
            // Collapsed like a channel timeline: the first replies, then a
            // "more replies" control that expands the rest.
            expanded={false}
          />
        </Match>
      </Switch>
      {/* The wrapper carries the position: the button's tooltip anchors to
          it, and the thread keeps the card's full width underneath. */}
      <div class="absolute top-2 right-2">
        <Button
          variant="ghost"
          size="icon-md"
          label="View in channel"
          onClick={() => props.onOpen()}
        >
          <ArrowSquareOutIcon />
        </Button>
      </div>
    </article>
  );
}

/** Channel threads, newest reply first, each with its replies and reply input. */
export function ChannelThreadsView(props: ChannelThreadsViewProps) {
  const { query, threads } = useChannelThreadsQuery(
    () => props.channelId,
    () => true
  );
  const selectedChannel = () =>
    props.channelId ? props.resolveChannel(props.channelId) : undefined;
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  // A card being replied to stays mounted while scrolled away, so its draft
  // and focus survive virtualization.
  const [activeIndex, setActiveIndex] = createSignal<number>();
  const loadMoreNearEnd = (offset: number) => {
    const handle = virtualizer();
    if (
      !handle ||
      !query.hasNextPage ||
      query.isFetchingNextPage ||
      handle.scrollSize - handle.viewportSize - offset > LOAD_MORE_THRESHOLD
    )
      return;
    void query.fetchNextPage();
  };
  const title = () =>
    props.channelId
      ? (selectedChannel()?.name ?? 'Conversation threads')
      : 'All threads';

  return (
    <>
      <ViewShell.TopBar>
        <span class="min-w-0 truncate text-sm font-semibold">{title()}</span>
      </ViewShell.TopBar>
      <div class="relative min-h-0 flex-1">
        <Scroll scrollRef={setScrollRoot}>
          <div class="mx-auto flex w-full max-w-3xl flex-col px-4 py-4">
            <Switch>
              <Match when={query.isLoading}>
                <ThreadListSkeleton />
              </Match>
              <Match when={query.error}>
                <div class="flex min-h-40 flex-col items-center justify-center gap-2 text-sm text-ink-muted">
                  <span>Couldn’t load threads.</span>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => void query.refresh()}
                  >
                    Try again
                  </Button>
                </div>
              </Match>
              <Match when={threads().length === 0}>
                <div class="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
                  <h2 class="text-base font-semibold text-ink">
                    No threads yet
                  </h2>
                  <p class="text-sm text-ink-muted">
                    {props.channelId
                      ? 'Replies to messages in this conversation show up here.'
                      : 'Replies to messages in your conversations show up here.'}
                  </p>
                </div>
              </Match>
              <Match when={true}>
                <Virtualizer
                  ref={setVirtualizer}
                  data={threads()}
                  scrollRef={scrollRoot()}
                  startMargin={16}
                  bufferSize={800}
                  keepMounted={
                    activeIndex() === undefined ? undefined : [activeIndex()!]
                  }
                  onScroll={loadMoreNearEnd}
                >
                  {(thread, index) => (
                    <div
                      class="pb-6"
                      onFocusIn={() => setActiveIndex(index())}
                      onFocusOut={(event) => {
                        const next = event.relatedTarget;
                        if (
                          !(next instanceof Node) ||
                          !event.currentTarget.contains(next)
                        )
                          setActiveIndex(undefined);
                      }}
                    >
                      <ThreadCard
                        thread={thread}
                        channel={props.resolveChannel(thread.channelId)}
                        showChannel={props.channelId === undefined}
                        onOpen={() => props.onOpenThread(thread)}
                      />
                    </div>
                  )}
                </Virtualizer>
                <Show when={query.isFetchingNextPage}>
                  <div
                    role="status"
                    aria-label="Loading more threads"
                    class={CARD_CLASS}
                  >
                    <ThreadSkeleton />
                  </div>
                </Show>
              </Match>
            </Switch>
          </div>
        </Scroll>
      </div>
    </>
  );
}
