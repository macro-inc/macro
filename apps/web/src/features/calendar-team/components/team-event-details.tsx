import { createMemo, For, Show } from 'solid-js';
import type { CalendarEvent, CalendarTimeFormat } from '../../calendar/types';
import { parseLocalDate } from '../../calendar/utils/calendar-date';
import { sanitizeCalendarDescription } from '../../calendar/utils/calendar-description';
import { safeConferenceUrl } from '../../calendar/utils/conference-link';

/** A separate content surface deliberately exposes no event mutation or mention actions. */
export function TeamEventDetails(props: {
  event: CalendarEvent;
  timeFormat: CalendarTimeFormat;
  onOpenLink: (url: string) => void;
}) {
  const description = createMemo(() =>
    sanitizeCalendarDescription(props.event.description ?? '')
  );
  const conference = () => safeConferenceUrl(props.event.conferenceUrl);
  const schedule = () => {
    const event = props.event;
    const start = event.allDay
      ? parseLocalDate(event.start)
      : new Date(event.start);
    const endDate = event.allDay
      ? parseLocalDate(event.end)
      : new Date(event.end);
    if (
      !start ||
      !endDate ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(endDate.getTime())
    )
      return 'Time unavailable';
    const end = event.allDay ? new Date(endDate.getTime() - 1) : endDate;
    const format = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      ...(event.allDay
        ? {}
        : {
            timeStyle: 'short' as const,
            hour12: props.timeFormat === '12-hour',
          }),
    });
    return `${format.format(start)} – ${format.format(end)}${event.allDay ? ' · All day' : ''}`;
  };
  return (
    <section
      aria-label="Shared event details"
      class="flex flex-col gap-3 p-2 text-sm text-ink"
    >
      <h2 class="select-text text-lg font-semibold">{props.event.title}</h2>
      <p class="select-text text-xs text-ink-muted">{schedule()}</p>
      <p class="text-xs text-ink-muted">Shared in Macro · Read only</p>
      <Show
        when={
          props.event.teamProjection?.contributesToAvailability !== undefined
        }
      >
        <p class="text-xs text-ink-muted">
          {props.event.teamProjection?.contributesToAvailability
            ? "Counts toward this teammate's busy time."
            : 'From a calendar this teammate can access. Does not count toward their busy time.'}
        </p>
      </Show>
      <Show when={props.event.location}>
        <p class="select-text">{props.event.location}</p>
      </Show>
      <Show when={conference()}>
        {(url) => (
          <button
            type="button"
            class="self-start text-accent underline"
            onClick={() => props.onOpenLink(url())}
          >
            Join meeting
          </button>
        )}
      </Show>
      <Show when={description()}>
        {(html) => (
          <div
            class="select-text text-ink-muted [&_a]:text-accent [&_a]:underline"
            innerHTML={html()}
            onClick={(event) => {
              const anchor = (event.target as Element | null)?.closest(
                'a[href]'
              );
              if (!(anchor instanceof HTMLAnchorElement)) return;
              event.preventDefault();
              props.onOpenLink(anchor.href);
            }}
          />
        )}
      </Show>
      <Show when={props.event.organizerName || props.event.organizerEmail}>
        <p class="select-text text-xs text-ink-muted">
          Organizer: {props.event.organizerName || props.event.organizerEmail}
        </p>
      </Show>
      <Show when={props.event.attendees.length > 0}>
        <div class="flex flex-col gap-1 border-t border-edge-muted pt-3 text-xs">
          <p class="text-ink-muted">Guests</p>
          <For each={props.event.attendees}>
            {(attendee) => (
              <p class="select-text">
                {attendee.displayName || attendee.email}
                {attendee.isSelf ? ' (you)' : ''}
              </p>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
