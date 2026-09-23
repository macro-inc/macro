import type { z } from 'zod';
import type {
  invitationParticipantSchema,
  invitationSnapshotSchema,
  invitationTimeSchema,
} from './calendar-invitation-schema';

export type InvitationDateTime = z.infer<typeof invitationTimeSchema>;
export type InvitationParticipant = z.infer<typeof invitationParticipantSchema>;
export type CalendarInvitation = z.infer<typeof invitationSnapshotSchema>;

export type InvitationResponse = 'accepted' | 'tentative' | 'declined';
export type InvitationResolution =
  | {
      kind:
        | 'cancelled'
        | 'loading'
        | 'still_syncing'
        | 'disconnected'
        | 'no_match'
        | 'ambiguous'
        | 'unavailable';
    }
  | {
      kind: 'resolved';
      eventId: string;
      occurrenceKey: string;
      recurrenceId?: string;
      recurring: boolean;
      response?: InvitationResponse | 'needs_action';
      respondingEmail?: string;
      canRespond: boolean;
      canJoin: boolean;
      isCancelled: boolean;
      isNewer: boolean;
      isStale: boolean;
      current: CalendarInvitation;
    };

/** A message host supplies actions; the card never imports calendar block state. */
export type CalendarInvitationActions = {
  resolution?: InvitationResolution;
  pending?: boolean;
  error?: string;
  notice?: string;
  retryCalendar?: () => void;
  respond?: (response: InvitationResponse) => void;
  openCalendar?: () => void;
  openExternal?: (url: string) => void;
  connectCalendar?: () => void;
  showDay?: () => void;
  dayExpanded?: boolean;
};

/** Notifications and updates ahead of sync retain the email's own scheduling time. */
export function displayedInvitation(
  snapshot: CalendarInvitation,
  resolution?: InvitationResolution
): CalendarInvitation {
  return resolution?.kind === 'resolved' &&
    !resolution.isStale &&
    !['counter', 'reply', 'cancel'].includes(snapshot.method)
    ? resolution.current
    : snapshot;
}

export function safeInvitationUrl(value?: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url.href;
  } catch {
    return;
  }
}

/** Keep recurrence overrides with their series while preserving every component. */
export function groupCalendarInvitations(
  invitations: readonly CalendarInvitation[]
) {
  const groups = new Map<string, CalendarInvitation[]>();
  for (const invitation of invitations) {
    const values = groups.get(invitation.uid) ?? [];
    values.push(invitation);
    groups.set(invitation.uid, values);
  }
  return [...groups.values()].map((values) => {
    const primary =
      values.find((value) => !value.recurrence_id_raw) ?? values[0];
    return { primary, related: values.filter((value) => value !== primary) };
  });
}

export function invitationIsCancelled(invite: CalendarInvitation): boolean {
  return (
    invite.method === 'cancel' || invite.status?.toUpperCase() === 'CANCELLED'
  );
}

export function invitationSchedule(
  invite: CalendarInvitation,
  hour12: boolean,
  timeZone: string
): { when: string; secondary?: string; month: string; day: string } {
  const start = invite.start ?? invite.recurrence_id;
  if (!start)
    return {
      when: 'Time not included in this notification',
      month: '—',
      day: '—',
    };
  // Date-only and floating values are formatted as wall times in UTC, never
  // interpreted as instants in the viewer's zone.
  const date = new Date(
    start.kind === 'zoned'
      ? start.value
      : `${start.value}${start.kind === 'date' ? 'T00:00:00' : ''}Z`
  );
  if (!Number.isFinite(date.getTime()))
    return {
      when: 'Time unavailable — view original email',
      month: '—',
      day: '—',
    };
  const zone = start.kind === 'zoned' ? timeZone : 'UTC';
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: zone,
  });
  const tile = {
    month: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      timeZone: zone,
    }).format(date),
    day: new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      timeZone: zone,
    }).format(date),
  };
  if (start.kind === 'date') {
    const end =
      invite.end?.kind === 'date'
        ? new Date(`${invite.end.value}T00:00:00Z`)
        : undefined;
    const last =
      end && Number.isFinite(end.getTime())
        ? new Date(end.getTime() - 86400000)
        : date;
    return {
      ...tile,
      when: `${dateFormat.format(date)}${last > date ? ` – ${dateFormat.format(last)}` : ''}`,
      secondary: 'All day',
    };
  }
  const clock = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12,
    timeZone: zone,
  });
  const end =
    invite.end && invite.end.kind === start.kind
      ? new Date(
          invite.end.kind === 'zoned'
            ? invite.end.value
            : `${invite.end.value}Z`
        )
      : undefined;
  const endLabel =
    end && Number.isFinite(end.getTime())
      ? `${dateFormat.format(end) === dateFormat.format(date) ? '' : `${dateFormat.format(end)} · `}${clock.format(end)}`
      : undefined;
  const timeZoneName =
    start.kind === 'zoned'
      ? new Intl.DateTimeFormat(undefined, {
          timeZone: zone,
          timeZoneName: 'short',
        })
          .formatToParts(date)
          .find((p) => p.type === 'timeZoneName')?.value
      : undefined;
  const when = `${dateFormat.format(date)} · ${clock.format(date)}${endLabel ? `–${endLabel}` : ''}${timeZoneName ? ` ${timeZoneName}` : ''}`;
  if (start.kind === 'unresolved')
    return {
      ...tile,
      when,
      secondary: start.time_zone
        ? `Timezone unresolved: ${start.time_zone}. Check the original invitation.`
        : 'Floating time — no timezone supplied.',
    };
  const minutes = end
    ? Math.round((end.getTime() - date.getTime()) / 60000)
    : 0;
  return {
    ...tile,
    when,
    secondary:
      [
        minutes > 0 ? `${minutes} minutes` : undefined,
        start.time_zone !== timeZone && start.time_zone !== 'UTC'
          ? `Organizer timezone: ${start.time_zone}`
          : undefined,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
  };
}
