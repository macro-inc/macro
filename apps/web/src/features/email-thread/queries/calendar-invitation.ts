import type { InvitationResolution as WireResolution } from '@service-email/generated/schemas/invitationResolution';
import type {
  CalendarInvitation,
  InvitationDateTime,
  InvitationResolution,
} from '../../email-message/core/calendar-invitation';

/** Project only complete, authorized current calendar data onto the small card. */
export function invitationResolution(
  snapshot: CalendarInvitation,
  wire?: WireResolution
): InvitationResolution {
  if (!wire || wire.kind !== 'resolved')
    return { kind: wire?.kind ?? 'no_match' };
  const time = wire.occurrence.time;
  const start: InvitationDateTime =
    time.kind === 'timed'
      ? {
          kind: 'zoned',
          value: time.startsAt,
          local: time.startsAt,
          time_zone:
            wire.event.time.kind === 'timed'
              ? (wire.event.time.timeZone ?? 'UTC')
              : 'UTC',
        }
      : { kind: 'date', value: time.startDate };
  const end: InvitationDateTime =
    time.kind === 'timed'
      ? {
          kind: 'zoned',
          value: time.endsAt,
          local: time.endsAt,
          time_zone: start.kind === 'zoned' ? start.time_zone : 'UTC',
        }
      : { kind: 'date', value: time.endDate };
  const cancelled =
    wire.event.status === 'cancelled' || wire.occurrence.isCancelled;
  return {
    kind: 'resolved',
    eventId: wire.event.id,
    occurrenceKey: wire.occurrence.occurrenceKey,
    recurrenceId: wire.occurrence.recurrenceId ?? undefined,
    recurring:
      wire.event.recurrenceLines.length > 0 || !!wire.occurrence.recurrenceId,
    response: wire.event.attendees.find((a) => a.isSelf)?.responseStatus,
    respondingEmail: wire.responding_email,
    canRespond: wire.can_respond,
    canJoin: wire.can_join,
    isCancelled: cancelled,
    isStale: wire.is_stale,
    isNewer: wire.event.sequence > snapshot.sequence,
    current: {
      ...snapshot,
      title: wire.event.title,
      location: wire.event.location,
      description: wire.event.description,
      organizer: wire.event.organizerEmail
        ? { email: wire.event.organizerEmail, name: wire.event.organizerName }
        : undefined,
      attendees: wire.event.attendees.map((a) => ({
        email: a.email,
        name: a.displayName,
        participation_status: a.responseStatus.toUpperCase(),
      })),
      start,
      end,
      conference_url: wire.event.conferenceUrl,
      status: cancelled ? 'CANCELLED' : wire.event.status,
    },
  };
}
