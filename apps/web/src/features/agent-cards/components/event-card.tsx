import {
  type CalendarEventOpenTarget,
  openCalendarEventSplit,
} from '@app/features/calendar-view/open-calendar-event';
import { useCalendarMentionPreviewQuery } from '@queries/calendar/mention-preview';
import { queryReadyGate } from '@queries/gate';
import type { CalendarMentionEvent } from '@service-storage/generated/schemas/calendarMentionEvent';
import { Show } from 'solid-js';
import { dayLabel, eventSchedule } from '../core/event-time';
import { actionLabel, actionTone } from '../core/labels';
import type { CardAction } from '../core/types';
import { Card, CardSingle } from './kit/card';
import { CardBadge, type CardTone, DateTile } from './kit/parts';
import { OpenArrow } from './reference-card';

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
  if (event.attendeeCount > 1) return `${event.attendeeCount} guests`;
  return event.organizerName ?? event.organizerEmail ?? undefined;
}

/**
 * An event as a card, from values already worked out: its day as a
 * calendar tile, its title, what happened to it, and when and where.
 */
export function EventCardView(props: {
  day: Date;
  past?: boolean;
  title: string;
  badge?: { label: string; tone: CardTone };
  meta: string;
  onOpen?: (event: MouseEvent) => void;
  muted?: boolean;
  canceled?: boolean;
}) {
  return (
    <Card
      width="compact"
      height={72}
      onOpen={props.onOpen}
      label={`Open ${props.title}`}
      muted={props.muted}
      data-agent-card="event"
    >
      <CardSingle
        tile={<DateTile date={props.day} past={props.past} />}
        title={props.title}
        struck={props.canceled}
        badge={
          <Show when={props.badge}>
            {(badge) => (
              <CardBadge tone={badge().tone}>{badge().label}</CardBadge>
            )}
          </Show>
        }
        meta={props.meta}
        trailing={
          <Show when={props.onOpen}>
            <OpenArrow />
          </Show>
        }
      />
    </Card>
  );
}

/**
 * A calendar event, from the viewer's own copy of the meeting: its day as a
 * calendar tile, its title, and when and where on one line. A receipt names
 * what the agent did to it - scheduled, updated, canceled.
 */
export function EventCard(props: {
  eventId: string;
  occurrenceKey?: string;
  action?: CardAction;
  title?: string | null;
  summary?: string | null;
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
    props.action
      ? {
          label: actionLabel('calendar_event', props.action),
          tone: actionTone(props.action),
        }
      : undefined;
  const unavailable = () => queryReadyGate(query) && query.data === null;
  const title = () => event()?.title || props.title || 'Event';
  const meta = () => {
    const when = schedule();
    if (!when) {
      if (props.summary) return props.summary;
      if (unavailable()) return 'Event · Not on your calendar';
      return query.isError ? "Event · Couldn't load" : 'Event · Loading…';
    }
    const loaded = event();
    return [
      `${dayLabel(when.day)} ${when.time}`,
      props.summary ?? (loaded ? eventDetail(loaded) : undefined),
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const open = () => {
    const to = target();
    return to
      ? (click: MouseEvent) =>
          void openCalendarEventSplit({ ...to, openInNewSplit: click.shiftKey })
      : undefined;
  };

  return (
    <EventCardView
      day={schedule()?.day ?? new Date()}
      past={schedule()?.past ?? true}
      title={title()}
      badge={badge()}
      meta={meta()}
      onOpen={open()}
      muted={unavailable()}
      canceled={props.action === 'deleted'}
    />
  );
}
