import { Popover } from '@kobalte/core/popover';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ClockIcon from '@phosphor/clock.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import CloseIcon from '@phosphor/x.svg';
import { Layer } from '@ui';
import { Show } from 'solid-js';
import type { CalendarEvent } from './types';

const formatDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
});
const formatShortDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const formatTime = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function parseCalendarDate(value: string) {
  if (!isDateOnly(value)) return new Date(value);

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

const isSameLocalDate = (first: Date, second: Date) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

function formatEventSchedule(event: CalendarEvent) {
  const start = parseCalendarDate(event.start);
  const end = parseCalendarDate(event.end);

  if (event.allDay) {
    const inclusiveEnd = new Date(end);
    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
    return isSameLocalDate(start, inclusiveEnd)
      ? `${formatDate.format(start)} · All day`
      : `${formatShortDate.format(start)}–${formatShortDate.format(inclusiveEnd)} · All day`;
  }

  return isSameLocalDate(start, end)
    ? `${formatDate.format(start)} · ${formatTime.format(start)}–${formatTime.format(end)}`
    : `${formatDate.format(start)}, ${formatTime.format(start)}–${formatDate.format(end)}, ${formatTime.format(end)}`;
}

interface EventDetailsPopoverProps {
  anchor: HTMLElement | undefined;
  event: CalendarEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Anchors a controlled, read-only details popover to a rendered event. */
export function EventDetailsPopover(props: EventDetailsPopoverProps) {
  return (
    <Popover
      anchorRef={() => props.anchor}
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="right-start"
      gutter={8}
      flip
      slide
    >
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content class="z-modal max-w-[calc(100vw-2rem)] outline-none">
            <Popover.Arrow class="fill-surface" />
            <div class="w-80 max-w-full rounded-xl bg-surface p-3 text-ink shadow-menu ring ring-edge-muted">
              <div class="flex items-start gap-2">
                <div
                  aria-hidden="true"
                  class="mt-1 size-2.5 shrink-0 rounded-sm"
                  style={{ 'background-color': props.event.calendar.color }}
                />
                <div class="min-w-0 flex-1">
                  <Popover.Title class="text-sm font-semibold leading-snug text-ink">
                    {props.event.title}
                  </Popover.Title>
                  <div class="mt-2 flex flex-col gap-2 text-xs text-ink-muted">
                    <div class="flex items-start gap-2">
                      <Show
                        when={props.event.allDay}
                        fallback={
                          <ClockIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                        }
                      >
                        <CalendarIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                      </Show>
                      <span>{formatEventSchedule(props.event)}</span>
                    </div>
                    <Show when={props.event.location}>
                      {(location) => (
                        <div class="flex items-start gap-2">
                          <MapPinIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                          <span>{location()}</span>
                        </div>
                      )}
                    </Show>
                    <div class="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        class="size-2 shrink-0 rounded-sm"
                        style={{
                          'background-color': props.event.calendar.color,
                        }}
                      />
                      <span>{props.event.calendar.name}</span>
                    </div>
                  </div>
                  <Show when={props.event.description}>
                    {(description) => (
                      <Popover.Description class="mt-3 border-t border-edge-muted pt-3 text-xs leading-relaxed text-ink-muted">
                        {description()}
                      </Popover.Description>
                    )}
                  </Show>
                </div>
                <Popover.CloseButton
                  aria-label="Close event details"
                  class="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-extra-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring focus-visible:ring-accent"
                >
                  <CloseIcon class="size-3.5" />
                </Popover.CloseButton>
              </div>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
