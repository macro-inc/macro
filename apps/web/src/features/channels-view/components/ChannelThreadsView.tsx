import { ViewShell } from '@app/components/view-shell';
import { MessageThreadById } from '@core/messages/MessageThread';
import type { ChannelEntity, ChannelThreadEntity } from '@entity';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, Scroll } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { useChannelThreadsQuery } from '../queries/channel-threads';
import { ChannelAvatar } from './rail/ChannelRailItems';

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
  return (
    <article
      class="flex flex-col gap-2 rounded-xl border border-edge-muted bg-surface p-3"
      data-channel-thread={props.thread.id}
    >
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
      <MessageThreadById
        parent={{ type: 'channel', id: props.thread.channelId }}
        rootId={props.thread.id}
        // Channels the rail knows about say whether the viewer can post;
        // anything else is left to the server to refuse.
        canWrite={props.channel?.isParticipant !== false}
      />
      <footer class="flex justify-end">
        <Button variant="ghost" size="xs" onClick={() => props.onOpen()}>
          <ArrowSquareOutIcon class="size-3.5" />
          View in channel
        </Button>
      </footer>
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
        <Scroll>
          <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
            <Switch>
              <Match when={query.isLoading}>
                <div class="grid min-h-40 place-items-center text-ink-muted">
                  <SpinnerIcon
                    aria-label="Loading threads"
                    class="size-5 animate-spin"
                  />
                </div>
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
                <For each={threads()}>
                  {(thread) => (
                    <ThreadCard
                      thread={thread}
                      channel={props.resolveChannel(thread.channelId)}
                      showChannel={props.channelId === undefined}
                      onOpen={() => props.onOpenThread(thread)}
                    />
                  )}
                </For>
                <Show when={query.hasNextPage}>
                  <div class="flex justify-center py-2">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={query.isFetchingNextPage}
                      onClick={() => void query.fetchNextPage()}
                    >
                      {query.isFetchingNextPage
                        ? 'Loading…'
                        : 'Load more threads'}
                    </Button>
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
