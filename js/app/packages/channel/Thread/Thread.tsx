import IconPlus from '@icon/regular/plus.svg';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import { createSignal, For, Match, Show, Suspense, Switch } from 'solid-js';
import { ChannelMessage } from '../Message';
import { ThreadRailDecorations } from './ThreadRailDecorations';
import { ThreadRepliesContainer } from './ThreadRepliesContainer';
import { replyCenterOffsetX } from './thread-rail-geometry';
import type { ThreadProps } from './types';

const DEFAULT_REPLY_COUNT = 3;

export function Thread(props: ThreadProps) {
  const [isReplying, setIsReplying] = createSignal(false);

  const thread = () => props.data().thread;
  const hasReplies = () => thread().reply_count > 0;

  const repliesQuery = useThreadRepliesQuery(
    props.channelId,
    () => props.data().id,
    () => props.data().thread.reply_count > 0
  );

  const previewReplies = () => thread().preview.slice(0, DEFAULT_REPLY_COUNT);
  // Keep existing runtime behavior while isolating rail refactors.
  const fetchedReplies = () =>
    (repliesQuery.data as unknown as ReturnType<typeof previewReplies> | undefined) ??
    [];
  const moreRepliesCount = () => thread().reply_count - DEFAULT_REPLY_COUNT;

  const expand = () => {
    props.setIsExpanded(true);
  };

  return (
    <div class="flex flex-col w-full">
      <ChannelMessage message={props.data()} />
      <Show when={hasReplies()}>
        <div class="relative w-full">
          <ThreadRailDecorations isReplying={isReplying} />
          <ThreadRepliesContainer>
            <For each={previewReplies()}>
              {(reply) => <ChannelMessage message={reply} />}
            </For>

            <Show when={!props.isExpanded() && moreRepliesCount() > 0}>
              <button
                type="button"
                class="text-xs text-ink-muted hover:text-ink w-fit"
                style={{
                  'margin-left': replyCenterOffsetX,
                }}
                onClick={expand}
              >
                Show {moreRepliesCount()} more{' '}
                {moreRepliesCount() === 1 ? 'reply' : 'replies'}
              </button>
            </Show>

            <Show when={props.isExpanded()}>
              <Suspense>
                <For each={fetchedReplies()}>
                  {(reply) => <ChannelMessage message={reply} />}
                </For>
              </Suspense>
            </Show>

            <Switch>
              <Match when={!isReplying()}>
                <button
                  type="button"
                  onClick={() => setIsReplying(true)}
                  class="w-min -translate-x-1/2 icon-plus allow-css-brackets"
                  style={{
                    'margin-left': replyCenterOffsetX,
                  }}
                  aria-label="Reply"
                >
                  <div class="border border-edge-muted bg-menu hover:bg-hover hover-transition-bg flex flex-row justify-center items-center ml-2 mr-2 mb-2 size-[var(--user-icon-width)] touch:min-h-[var(--user-icon-width)] touch:min-w-[var(--user-icon-width)] text-ink-muted">
                    <IconPlus class="size-1/2" />
                  </div>
                </button>
              </Match>
            </Switch>
          </ThreadRepliesContainer>
        </div>
      </Show>
    </div>
  );
}
