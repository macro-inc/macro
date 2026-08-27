import { UserIcon } from '@core/component/UserIcon';
import { formatRelativeDate } from '@core/util/time';
import CaretRight from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import { For, type JSX, Show, splitProps } from 'solid-js';
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
  const visibleParticipants = () =>
    local.participants.slice(0, MAX_VISIBLE_PARTICIPANTS);
  const hiddenParticipants = () =>
    Math.max(local.participants.length - visibleParticipants().length, 0);

  return (
    <button
      type="button"
      title="Expand thread"
      class={cn(
        'flex items-center gap-2 text-xs w-fit h-8 touch:min-h-(--user-icon-width) border bg-surface hover:bg-hover py-1 pr-2 pl-1.5 mb-2 select-none outline-none focus-visible:bg-active rounded-full',
        local.hasNewMessages ? 'border-accent/40' : 'border-thread-rail',
        local.class
      )}
      {...rest}
    >
      <Show when={local.participants.length > 0}>
        <div class="flex items-center">
          <For each={visibleParticipants()}>
            {(userId, index) => (
              <div
                class={cn(
                  'size-4.5 rounded-full ring-2 ring-surface *:size-full *:rounded-full',
                  index() > 0 && '-ml-1'
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
            <span class="ml-1 text-xxs text-ink-muted tabular-nums">
              +{hiddenParticipants()}
            </span>
          </Show>
        </div>
      </Show>
      <Show when={local.hasNewMessages}>
        <span class="size-1.5 shrink-0 rounded-full bg-accent" />
      </Show>
      <span class="text-accent font-medium whitespace-nowrap">
        {getThreadReplyCountLabel(local.collapsedRepliesCount)}
      </span>
      <Show when={local.latestReplyAt}>
        {(latestReplyAt) => (
          <span class="text-ink-muted whitespace-nowrap @max-[40rem]:hidden">
            Last reply {formatRelativeDate(latestReplyAt())}
          </span>
        )}
      </Show>
      <CaretRight class="size-3.5 shrink-0 text-ink-muted" />
    </button>
  );
}
