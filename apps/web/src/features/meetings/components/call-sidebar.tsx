import PhoneIcon from '@phosphor/phone.svg';
import { Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import type { ActiveQuickCall } from '../context/call-sidebar';
import type { UpcomingCalendarEvent } from '../core/upcoming-calendar-events';

function CallListError(props: { message: string; onRetry: () => void }) {
  return (
    <div
      class="flex items-center justify-between gap-2 px-2 py-1 text-xs text-ink-muted"
      role="status"
    >
      <span>{props.message}</span>
      <button type="button" class="shrink-0 underline" onClick={props.onRetry}>
        Retry
      </button>
    </div>
  );
}

export function CallSidebar(props: {
  active: ActiveQuickCall[];
  upcoming: UpcomingCalendarEvent[];
  upcomingLoading: boolean;
  activeError?: string;
  upcomingError?: string;
  when: (call: UpcomingCalendarEvent) => string;
  canJoin: (event: UpcomingCalendarEvent) => boolean;
  onOpenEvent: (event: UpcomingCalendarEvent, anchor: HTMLElement) => void;
  onJoin: (url: string) => void;
  onRetryActive: () => void;
  onRetryUpcoming: () => void;
}) {
  return (
    <div class="flex flex-col gap-1">
      <For each={props.active}>
        {(call) => (
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg bg-hover px-2 py-2 text-left hover:bg-active focus-visible:bg-active"
            onClick={() => props.onJoin(call.url)}
            aria-label={`Join ${call.title}`}
          >
            <PhoneIcon
              aria-hidden="true"
              class="size-3.5 shrink-0 text-success"
            />
            <Tooltip as="span" class="min-w-0 flex-1" label={call.title}>
              <span class="truncate text-xs font-medium text-ink">
                {call.title}
              </span>
            </Tooltip>
            <span class="ml-auto shrink-0 text-[10px] text-success">
              Live now
            </span>
          </button>
        )}
      </For>
      <Show when={props.active.length > 0 && props.activeError}>
        {(error) => (
          <CallListError message={error()} onRetry={props.onRetryActive} />
        )}
      </Show>
      <For each={props.upcoming}>
        {(calendarEvent) => (
          <div class="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-hover">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:bg-hover"
              onClick={(event) =>
                props.onOpenEvent(calendarEvent, event.currentTarget)
              }
              aria-label={`Open ${calendarEvent.title}`}
            >
              <Tooltip
                as="span"
                class="min-w-0 flex-1"
                label={calendarEvent.title}
              >
                <span class="truncate text-xs text-ink">
                  {calendarEvent.title}
                </span>
              </Tooltip>
              <span class="ml-auto shrink-0 text-[10px] tabular-nums text-ink-muted">
                {props.when(calendarEvent)}
              </span>
            </button>
            <Show when={props.canJoin(calendarEvent) && calendarEvent.url}>
              {(url) => (
                <button
                  type="button"
                  class="shrink-0 rounded-md bg-ink-muted/10 px-2 py-1 text-xs text-ink hover:bg-active"
                  aria-label={`Join ${calendarEvent.title}`}
                  onClick={() => props.onJoin(url())}
                >
                  Join
                </button>
              )}
            </Show>
          </div>
        )}
      </For>
      <Show when={props.upcomingLoading && props.upcoming.length === 0}>
        <div
          role="status"
          aria-label="Loading events"
          class="space-y-1 px-2 py-1"
        >
          <div class="skeleton-shimmer h-7 rounded-md bg-skeleton" />
          <div class="skeleton-shimmer h-7 rounded-md bg-skeleton" />
        </div>
      </Show>
      <Show when={props.upcomingError}>
        {(error) => (
          <CallListError message={error()} onRetry={props.onRetryUpcoming} />
        )}
      </Show>
      <Show
        when={
          !props.upcomingLoading &&
          !props.upcomingError &&
          props.upcoming.length === 0
        }
      >
        <p class="px-2 py-1 text-xs text-ink-muted">No upcoming events</p>
      </Show>
    </div>
  );
}
