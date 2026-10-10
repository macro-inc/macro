import {
  type CalendarEventOpenTarget,
  openCalendarEventSplit,
} from '@app/features/calendar-view/open-calendar-event';
import { useCalendarMentionPreviewQuery } from '@queries/calendar/mention-preview';
import { queryReadyGate } from '@queries/gate';
import type { CalendarMentionEvent } from '@service-storage/generated/schemas/calendarMentionEvent';
import { Show } from 'solid-js';
import { dayLabel, eventSchedule } from '../core/event-time';
import { actionLabel } from '../core/labels';
import type { CardAction } from '../core/types';
import { CardShell } from './card-shell';

/**
 * Where opening an event goes for this viewer: their own copy of the
 * meeting. One shared with them through a channel but on none of their
 * calendars has nothing to open.
 */
export function eventOpenTarget(
  occurrenceKey: string | undefined,
  event: CalendarMentionEvent
): Omit<CalendarEventOpenTarget, 'openInNewSplit'> | undefined {
  if (!event.viewerEventId) return undefined;
  return {
    eventId: event.viewerEventId,
    occurrenceKey: occurrenceKey ?? event.occurrenceKey ?? undefined,
    // The preview's time locates only the instance it previewed.
    time:
      !occurrenceKey || occurrenceKey === event.occurrenceKey
        ? event.time
        : undefined,
  };
}

/** One line about who and where: the place, else the people. */
export function eventDetail(event: CalendarMentionEvent): string | undefined {
  if (event.location) return event.location;
  if (event.attendeeCount > 1) return `${event.attendeeCount} people`;
  return event.organizerName ?? event.organizerEmail ?? undefined;
}

/** A calendar page: the month over the day, past events quieter. */
export function DateTile(props: { day: Date; past?: boolean }) {
  return (
    <span
      class="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg border border-edge-muted bg-panel leading-none"
      aria-hidden="true"
    >
      <span
        class={
          props.past
            ? 'text-[9px] font-semibold tracking-wide text-ink-extra-muted uppercase'
            : 'text-[9px] font-semibold tracking-wide text-accent uppercase'
        }
      >
        {props.day.toLocaleDateString('en-US', { month: 'short' })}
      </span>
      <span class="mt-0.5 text-base font-semibold text-ink tabular-nums">
        {props.day.getDate()}
      </span>
    </span>
  );
}

/**
 * A calendar event, from the viewer's own copy of the meeting: when, what,
 * and where, with the day it falls on.
 */
export function EventCard(props: {
  eventId: string;
  occurrenceKey?: string;
  action?: CardAction;
  title?: string | null;
}) {
  const query = useCalendarMentionPreviewQuery(() => ({
    eventId: props.eventId,
    occurrenceKey: props.occurrenceKey,
  }));
  const event = () => (queryReadyGate(query) ? query.data : undefined);
  const schedule = () => {
    const loaded = event();
    return loaded ? eventSchedule(loaded.time) : undefined;
  };
  const target = () => {
    const loaded = event();
    return loaded ? eventOpenTarget(props.occurrenceKey, loaded) : undefined;
  };
  const badge = () =>
    props.action ? actionLabel('calendar_event', props.action) : undefined;
  const unavailable = () =>
    queryReadyGate(query) && query.data === null ? 'Not on your calendar' : '';

  return (
    <Show
      when={schedule()}
      fallback={
        <CardShell
          tile={<DateTile day={new Date()} past />}
          title={props.title || 'Event'}
          badge={badge()}
          meta={unavailable() || (query.isError ? "Couldn't load" : 'Loading…')}
          muted={!!unavailable()}
        />
      }
    >
      {(when) => (
        <CardShell
          tile={<DateTile day={when().day} past={when().past} />}
          title={event()?.title || props.title || 'Event'}
          badge={badge()}
          meta={`${dayLabel(when().day)} · ${when().time}`}
          detail={(() => {
            const loaded = event();
            return loaded ? eventDetail(loaded) : undefined;
          })()}
          onOpen={
            target()
              ? (click) =>
                  void openCalendarEventSplit({
                    ...target()!,
                    openInNewSplit: click.shiftKey,
                  })
              : undefined
          }
        />
      )}
    </Show>
  );
}
