import { useUserId } from '@core/context/user';
import {
  createCalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import {
  type CalendarInvitation,
  invitationSchedule,
} from '../email-message/core/calendar-invitation';
import {
  invitationConflicts,
  occurrenceAtInvitationTime,
} from './queries/invitation-conflict';

/**
 * A local-day agenda using the same occurrence cache as the calendar. The
 * viewer's own copy of the event, at the invitation's time, is the
 * invitation's row in its time slot; the invitation's own time stands above
 * the list only while no such row is in it.
 */
export function CalendarInvitationDay(props: {
  invitation: CalendarInvitation;
  eventId: string;
  occurrenceKey: string;
  hour12: boolean;
  onClose: () => void;
}) {
  const userId = useUserId();
  const range = () => {
    const start = props.invitation.start;
    if (!start || start.kind === 'unresolved') return;
    const day =
      start.kind === 'date'
        ? new Date(`${start.value}T00:00:00`)
        : new Date(start.value);
    if (!Number.isFinite(day.getTime())) return;
    day.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    return createCalendarOccurrenceQueryRange(day, end);
  };
  const query = useCalendarOccurrencesQuery(() => ({
    userId: userId(),
    range: range(),
  }));
  const data = () => (query.isSuccess ? query.data : undefined);
  const items = () => data()?.items.slice(0, 20);
  const isEvent = (item: CalendarOccurrenceItem) =>
    item.event.id === props.eventId &&
    item.occurrence.occurrenceKey === props.occurrenceKey;
  const isInvitation = (item: CalendarOccurrenceItem) =>
    isEvent(item) && occurrenceAtInvitationTime(props.invitation, item);
  const invitationListed = () => items()?.some(isInvitation) ?? false;
  const label = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: props.hour12,
    }).format(new Date(value));
  return (
    <section
      aria-label="Your day"
      class="mb-4 rounded-lg border border-edge-muted p-4 text-sm"
    >
      <div class="flex items-center justify-between">
        <h4 class="font-medium">Your day</h4>
        <Button variant="ghost" class="min-h-11" onClick={props.onClose}>
          Close
        </Button>
      </div>
      <Show when={!query.isLoading && !invitationListed()}>
        <p class="my-3 rounded-md bg-accent-bg p-3 text-ink">
          <span class="mr-2 font-medium">This invitation</span>
          {
            invitationSchedule(
              props.invitation,
              props.hour12,
              Intl.DateTimeFormat().resolvedOptions().timeZone
            ).when
          }
        </p>
      </Show>
      <Show
        when={range()}
        fallback={
          <p role="status">
            This invitation's time is unresolved, so conflicts could not be
            checked.
          </p>
        }
      >
        <Show when={query.isPending}>
          <p role="status">Loading calendar…</p>
        </Show>
      </Show>
      <Show when={query.isError}>
        <p role="status">
          Calendar unavailable. Conflicts could not be checked.
        </p>
      </Show>
      <Show when={data()?.syncStatus === 'syncing'}>
        <p role="status">Calendar is syncing. This agenda may be incomplete.</p>
      </Show>
      <Show
        when={data()?.items.length === 0 && data()?.syncStatus !== 'syncing'}
      >
        <p>No events found for this day.</p>
      </Show>
      <ul class="mt-3 flex flex-col gap-2">
        <For each={items()}>
          {(item) => (
            <li
              class="rounded-md p-2 [overflow-wrap:anywhere]"
              classList={{ 'bg-accent-bg': isEvent(item) }}
            >
              <span class="mr-3 text-ink-muted">
                {item.occurrence.time.kind === 'timed'
                  ? `${label(item.occurrence.time.startsAt)}–${label(item.occurrence.time.endsAt)}`
                  : 'All day'}
              </span>
              {item.event.title}
              <Show when={isInvitation(item)}>
                <span class="ml-2 font-medium">This invitation</span>
              </Show>
              <Show when={invitationConflicts(props.invitation, item, props)}>
                <span class="ml-2 text-ink-muted">
                  Overlaps this invitation
                </span>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={(data()?.items.length ?? 0) > 20}>
        <p class="mt-2 text-ink-muted">
          More events are available in your calendar.
        </p>
      </Show>
    </section>
  );
}
