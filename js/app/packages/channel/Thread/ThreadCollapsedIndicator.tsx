import { UserIcon } from '@core/component/UserIcon';
import { formatRelativeDate } from '@core/util/time';
import CaretRight from '@icon/regular/caret-right.svg';
import { cn } from '@ui/utils/classname';
import {
  For,
  Match,
  Show,
  Switch,
  createSignal,
  splitProps,
  type JSX,
} from 'solid-js';
import { getThreadReplyCountLabel } from './utils/thread-reply-indicator-helpers';

type ThreadCollapsedIndicatorProps =
  JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    collapsedRepliesCount: number;
    participants: string[];
    latestReplyAt?: string;
  };

const MAX_VISIBLE_PARTICIPANTS = 4;

export function ThreadCollapsedIndicator(props: ThreadCollapsedIndicatorProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'collapsedRepliesCount',
    'participants',
    'latestReplyAt',
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
        'flex flex-row gap-2 items-center text-xs w-fit h-[var(--user-icon-width)] touch:min-h-[var(--user-icon-width)] border border-edge-muted bg-menu hover:bg-hover hover-transition-bg pr-2 pl-1 mb-2 select-none focus:bracket-offset-2',
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
                    'size-[18px] [&>*]:size-full [&>*]:rounded-full',
                    index() > 0 ? '-ml-1' : ''
                  )}
                >
                  <UserIcon
                    id={userId}
                    size="fill"
                    suppressClick
                    showTooltip={false}
                    isDeleted={false}
                    fetchUrl={false}
                  />
                </div>
              )}
            </For>
            <Show when={hiddenParticipants() > 0}>
              <p class="ml-1 text-[10px] text-ink-muted">
                +{hiddenParticipants()}
              </p>
            </Show>
          </div>
        </Show>
        <p class="text-accent-ink font-medium whitespace-nowrap">
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
