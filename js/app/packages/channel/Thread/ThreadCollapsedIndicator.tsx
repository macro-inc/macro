import { UserIcon } from '@core/component/UserIcon';
import { formatRelativeDate } from '@core/util/time';
import CaretRight from '@icon/caret-right.svg';
import { cn } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
  splitProps,
} from 'solid-js';
import { getThreadReplyCountLabel } from './utils/thread-reply-indicator-helpers';

type ThreadCollapsedIndicatorProps =
  JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    collapsedRepliesCount: number;
    participants: string[];
    latestReplyAt?: string;
    hasNewMessages?: boolean;
  };

const MAX_VISIBLE_PARTICIPANTS = 4;

export function ThreadCollapsedIndicator(props: ThreadCollapsedIndicatorProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'collapsedRepliesCount',
    'participants',
    'latestReplyAt',
    'hasNewMessages',
  ]);
  const [hover, setHover] = createSignal(false);
  const visibleParticipants = () =>
    local.participants.slice(0, MAX_VISIBLE_PARTICIPANTS);
  const hiddenParticipants = () =>
    Math.max(local.participants.length - visibleParticipants().length, 0);

  return (
    <button
      type="button"
      class={cn(
        'flex flex-row gap-2 items-center text-xs w-fit h-(--user-icon-width) touch:min-h-(--user-icon-width) border bg-surface hover:bg-hover hover-transition-bg pr-2 pl-1 mb-2 select-none outline-none focus:bg-active',
        local.hasNewMessages ? 'border-accent' : 'border-edge-muted',
        local.class
      )}
      onMouseEnter={() => {
        setHover(true);
      }}
      onMouseLeave={() => {
        setHover(false);
      }}
      {...rest}
    >
      <div class="flex flex-row items-center gap-2 px-1">
        <Show when={local.participants.length > 0}>
          <div class="flex flex-row items-center">
            <For each={visibleParticipants()}>
              {(userId, index) => (
                <div
                  class={cn(
                    'size-4.5 *:size-full *:rounded-full',
                    index() > 0 ? '-ml-1' : ''
                  )}
                >
                  <UserIcon
                    id={userId}
                    size="fill"
                    suppressClick
                    showTooltip={false}
                  />
                </div>
              )}
            </For>
            <Show when={hiddenParticipants() > 0}>
              <p class="ml-1 text-xxs text-ink-muted">
                +{hiddenParticipants()}
              </p>
            </Show>
          </div>
        </Show>
        <p class="text-accent font-medium whitespace-nowrap">
          {getThreadReplyCountLabel(local.collapsedRepliesCount)}
        </p>
        <div class="hidden @min-[40rem]:block min-w-[15ch]">
          <Switch>
            <Match when={hover()}>
              <p class="text-ink-muted whitespace-nowrap">Expand thread</p>
            </Match>
            <Match when={!!local.latestReplyAt && !hover()}>
              <p class="text-ink-muted whitespace-nowrap">
                Last reply {formatRelativeDate(local.latestReplyAt!)}
              </p>
            </Match>
          </Switch>
        </div>
      </div>
      <CaretRight class={cn('size-4', hover() ? '' : 'invisible')} />
    </button>
  );
}
