import { Key } from '@solid-primitives/keyed';
import PhoneIcon from '@phosphor/phone.svg';
import { Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { TransitionGroup } from 'solid-transition-group';
import type { ActiveQuickCall } from '../context/call-sidebar';
import type { UpcomingCalendarEvent } from '../core/upcoming-calendar-events';

const ROW_DURATION = 240;
const BATCH_DURATION = 180;
const REPLACEMENT_DURATION = 300;
const ROW_STAGGER = 55;
const BATCH_STAGGER = 12;

function rowDelay(index: number, batch: boolean) {
  return batch ? Math.min(index * BATCH_STAGGER, 24) : index * ROW_STAGGER;
}

function animateUpcomingEnter(
  element: Element,
  done: () => void,
  delay: number,
  duration: number,
  overlap: boolean
) {
  if (
    !(element instanceof HTMLElement) ||
    typeof element.animate !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    done();
    return;
  }
  const size = element.scrollHeight;
  const height = `${size}px`;
  const frames: Keyframe[] = overlap
    ? [
        { height: '0px', opacity: 0, transform: 'translateX(-100%)', offset: 0 },
        {
          height: `${size * 0.75}px`,
          opacity: 0,
          transform: 'translateX(-100%)',
          offset: 0.45,
        },
        { height, opacity: 0.3, transform: 'translateX(-70%)', offset: 0.6 },
        { height, opacity: 1, transform: 'translateX(0)', offset: 1 },
      ]
    : [
        { height: '0px', opacity: 0, transform: 'translateX(-100%)' },
        { height, opacity: 1, transform: 'translateX(0)' },
      ];
  const animation = element.animate(frames, {
    delay,
    duration,
    easing: 'ease-out',
    fill: 'both',
  });
  animation.onfinish = done;
}

function animateUpcomingExit(
  element: Element,
  done: () => void,
  delay: number,
  duration: number,
  direction: 'left' | 'right'
) {
  if (
    !(element instanceof HTMLElement) ||
    typeof element.animate !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    done();
    return;
  }
  const size = element.getBoundingClientRect().height;
  const destination =
    direction === 'right' ? 'translateX(100%)' : 'translateX(-100%)';
  const animation = element.animate(
    [
      {
        height: `${size}px`,
        opacity: 1,
        transform: 'translateX(0)',
        offset: 0,
      },
      {
        height: `${size * 0.4}px`,
        opacity: 0,
        transform: destination,
        offset: 0.6,
      },
      { height: '0px', opacity: 0, transform: destination, offset: 1 },
    ],
    { delay, duration, easing: 'ease-in-out', fill: 'both' }
  );
  animation.onfinish = done;
}

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
  selectedEventId?: string;
  when: (call: UpcomingCalendarEvent) => string;
  canJoin: (event: UpcomingCalendarEvent) => boolean;
  onOpenEvent: (event: UpcomingCalendarEvent, anchor: HTMLElement) => void;
  onJoin: (url: string) => void;
  onRetryActive: () => void;
  onRetryUpcoming: () => void;
}) {
  const [exitingRows, setExitingRows] = createSignal(0);
  let nextExitIndex = 0;
  let nextEnterIndex = 0;
  let enteringCount = 0;
  return (
    <div class="flex min-w-0 flex-col gap-1 overflow-x-clip">
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
      <TransitionGroup
        moveClass="transition-transform duration-[240ms] ease-out"
        onBeforeEnter={(element) => {
          if (enteringCount === 0) {
            // Reset after this update's enter and exit callbacks have run.
            queueMicrotask(() => queueMicrotask(() => (enteringCount = 0)));
          }
          enteringCount++;
          if (!(element instanceof HTMLElement)) return;
          element.style.height = '0px';
          element.style.overflow = 'hidden';
          element.style.opacity = '0';
          element.style.transform = 'translateX(-100%)';
          element.inert = true;
        }}
        onEnter={(element, done) => {
          const index = nextEnterIndex++;
          if (index === 0) queueMicrotask(() => (nextEnterIndex = 0));
          const departing = exitingRows();
          const batch = departing >= 3 || enteringCount >= 3;
          const overlap = batch && departing > 0;
          // Grow batch replacements while old rows shrink, then reveal them.
          const start = departing && !batch
            ? 150 + (departing - 1) * ROW_STAGGER
            : 0;
          animateUpcomingEnter(
            element,
            done,
            start + rowDelay(index, batch),
            overlap ? REPLACEMENT_DURATION : batch ? BATCH_DURATION : ROW_DURATION,
            overlap
          );
        }}
        onAfterEnter={(element) => {
          if (
            !(element instanceof HTMLElement) ||
            element.getAttribute('aria-hidden') === 'true'
          ) return;
          element.style.height = '';
          element.style.overflow = '';
          element.style.opacity = '';
          element.style.transform = '';
          element.inert = false;
        }}
        onBeforeExit={(element) => {
          element.setAttribute('aria-hidden', 'true');
          if (element instanceof HTMLElement) {
            element.style.opacity = '';
            element.style.transform = '';
            element.inert = true;
          }
          setExitingRows((count) => count + 1);
        }}
        onExit={(element, done) => {
          const index = nextExitIndex++;
          if (index === 0) queueMicrotask(() => (nextExitIndex = 0));
          const replaced = enteringCount > 0;
          // All removals are known after the current update finishes.
          queueMicrotask(() => {
            const batch = exitingRows() >= 3 || enteringCount >= 3;
            animateUpcomingExit(
              element,
              done,
              rowDelay(index, batch),
              batch ? BATCH_DURATION : ROW_DURATION,
              replaced ? 'right' : 'left'
            );
          });
        }}
        onAfterExit={() => setExitingRows((count) => count - 1)}
      >
        <Key each={props.upcoming} by="id">
          {(calendarEvent) => (
            <div
              class="min-w-0 overflow-hidden rounded-lg"
              classList={{
                'bg-active': props.selectedEventId === calendarEvent().id,
                'hover:bg-hover': props.selectedEventId !== calendarEvent().id,
              }}
            >
              <div class="flex w-full items-center gap-2 px-2 py-2">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:bg-hover"
                  onClick={(event) =>
                    props.onOpenEvent(calendarEvent(), event.currentTarget)
                  }
                  aria-label={`Open ${calendarEvent().title}`}
                  aria-current={
                    props.selectedEventId === calendarEvent().id
                      ? 'true'
                      : undefined
                  }
                >
                  <span
                    aria-hidden="true"
                    class="size-2.5 shrink-0 rounded-sm"
                    style={{ 'background-color': calendarEvent().color }}
                  />
                  <Tooltip
                    as="span"
                    class="min-w-0 flex-1"
                    label={calendarEvent().title}
                  >
                    <span class="truncate text-xs text-ink">
                      {calendarEvent().title}
                    </span>
                  </Tooltip>
                  <span class="ml-auto shrink-0 text-xs tabular-nums text-ink-muted">
                    {props.when(calendarEvent())}
                  </span>
                </button>
                <Show when={props.canJoin(calendarEvent()) && calendarEvent().url}>
                  {(url) => (
                    <button
                      type="button"
                      class="shrink-0 rounded-md bg-ink-muted/10 px-2 py-1 text-xs text-ink hover:bg-active"
                      aria-label={`Join ${calendarEvent().title}`}
                      onClick={() => props.onJoin(url())}
                    >
                      Join
                    </button>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Key>
      </TransitionGroup>
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
          props.upcoming.length === 0 &&
          exitingRows() === 0
        }
      >
        <p class="px-2 py-1 text-xs text-ink-muted">No upcoming events</p>
      </Show>
    </div>
  );
}
