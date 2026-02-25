import IconPlus from '@icon/regular/plus.svg';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import {
  createEffect,
  createSignal,
  For,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { ChannelMessage } from '../Message';
import { ThreadRailDecorations } from './ThreadRailDecorations';
import { ThreadRepliesContainer } from './ThreadRepliesContainer';
import { replyCenterOffsetX } from './thread-rail-geometry';
import type { ThreadProps } from './types';
import type { ApiThreadReply } from '@service-comms/client';

const DEFAULT_REPLY_COUNT = 3;

function sliceIf<T>(
  val: Array<T>,
  start: number,
  end: number,
  should: boolean
): Array<T> {
  return should ? val.slice(start, end) : val;
}

function ThreadReplyList(props: { replies: Array<ApiThreadReply> }) {
  return (
    <For each={props.replies}>
      {(reply) => <ChannelMessage message={reply} />}
    </For>
  );
}

export function Thread(props: ThreadProps) {
  const [isReplying, setIsReplying] = createSignal(false);

  const thread = () => props.data().thread;
  const hasReplies = () => thread().reply_count > 0;
  const fetchRepliesEnabled = () => props.data().thread.reply_count > 0;

  const repliesQuery = useThreadRepliesQuery(
    props.channelId,
    () => props.data().id,
    fetchRepliesEnabled
  );

  const sliceIfNotExpanded =
    <T,>(val: Array<T>) =>
    () =>
      sliceIf(val, 0, DEFAULT_REPLY_COUNT, !props.isExpanded());

  const previewReplies = sliceIfNotExpanded(thread().preview ?? []);
  const fetchedReplies = sliceIfNotExpanded(repliesQuery.data ?? []);
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
            <Show
              when={fetchRepliesEnabled() && !repliesQuery.isLoading}
              fallback={<ThreadReplyList replies={previewReplies()} />}
            >
              <Suspense>
                <ThreadReplyList replies={fetchedReplies()} />
              </Suspense>
            </Show>

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
