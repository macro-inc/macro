import type { TeamCalendarItem } from '@service-storage/generated/schemas/teamCalendarItem';
import type { CalendarEvent } from '../../calendar/types';
import {
  teamCalendarColor,
  teamCalendarRenderId,
  teamCalendarSourceId,
} from '../core/model';

/** Only the server-authorized DTO enters this adapter; never normalize it as an own event. */
export function mapTeamCalendarItem(
  item: TeamCalendarItem,
  ownerName: string
): CalendarEvent {
  const time = item.time;
  const details = item.kind === 'details' ? item.details : undefined;
  const calendar = {
    id: teamCalendarSourceId(item.ownerId),
    name: ownerName,
    color: teamCalendarColor(item.ownerId),
  };
  const renderId = teamCalendarRenderId(item.ownerId, item.id);
  return {
    id: renderId,
    // These opaque placeholders satisfy the grid contract; teamProjection
    // prevents every canonical-event action and navigation path from using them.
    eventId: renderId,
    occurrenceKey: item.id,
    teamProjection: {
      ownerId: item.ownerId,
      kind: item.kind,
      contributesToAvailability: item.contributesToAvailability,
    },
    ...(time.kind === 'timed'
      ? { allDay: false, start: time.startsAt, end: time.endsAt }
      : { allDay: true, start: time.startDate, end: time.endDate }),
    timeZone: time.kind === 'timed' ? (time.timeZone ?? undefined) : undefined,
    isCancelled: false,
    isReadOnly: true,
    // The endpoint recomputes these flags for the requesting viewer.
    attendees: details?.attendees ?? [],
    recurrenceLines: [],
    sourceCalendarIds: [calendar.id],
    calendar,
    visibleCalendars: [calendar],
    title: `${ownerName}: ${details?.title ?? (item.contributesToAvailability ? 'Busy' : 'Shared calendar block')}`,
    description: details?.description ?? undefined,
    location: details?.location ?? undefined,
    conferenceUrl: details?.conferenceUrl ?? undefined,
    organizerEmail: details?.organizerEmail ?? undefined,
    organizerName: details?.organizerName ?? undefined,
  };
}
