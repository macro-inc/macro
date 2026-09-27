import { useAddInboxFlow } from '@core/email-link';
import { openExternalUrl } from '@core/util/url';
import {
  getCachedCalendarInvitations,
  useCalendarInvitationsQuery,
} from '@queries/calendar/invitations';
import type { EventTime } from '@service-email/generated/schemas/eventTime';
import { createSignal, Show, Suspense } from 'solid-js';
import { EventRsvpScopeDialog } from '../calendar/components/EventRsvpScopeDialog';
import { createCalendarRsvpController } from '../calendar/hooks/create-calendar-rsvp-controller';
import { useCalendarUiFlag } from '../calendar/hooks/use-calendar-ui-flag';
import { CalendarInviteCard } from '../email-message/components/calendar-invite-card';
import {
  type CalendarInvitation,
  displayedInvitation,
  type InvitationResolution,
} from '../email-message/core/calendar-invitation';
import { CalendarInvitationDay } from './calendar-invitation-day';
import { invitationResolution } from './queries/calendar-invitation';

export type CalendarInvitationOpenTarget = {
  eventId: string;
  occurrenceKey: string;
  time: EventTime;
};

export function EmailCalendarInvitation(props: {
  threadId: string;
  messageId: string;
  invitation: CalendarInvitation;
  hour12: boolean;
  openCalendar?: (target: CalendarInvitationOpenTarget) => void;
}) {
  return (
    <Suspense
      fallback={
        <CalendarInviteCard
          invitation={props.invitation}
          hour12={props.hour12}
        />
      }
    >
      <ConnectedInvitation {...props} />
    </Suspense>
  );
}
function ConnectedInvitation(
  props: Parameters<typeof EmailCalendarInvitation>[0]
) {
  const calendarEnabled = useCalendarUiFlag();
  const startAddInbox = useAddInboxFlow();
  const query = useCalendarInvitationsQuery(
    () => props.threadId,
    calendarEnabled
  );
  const [showDay, setShowDay] = createSignal(false);
  let dayTrigger: HTMLElement | undefined;
  const toggleDay = () => {
    dayTrigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    setShowDay((value) => !value);
  };
  const closeDay = () => {
    setShowDay(false);
    dayTrigger?.focus({ preventScroll: true });
  };
  // A failed refresh keeps the cached result; reading query.data would throw.
  const wire = () => {
    const key = `${props.messageId}:${props.invitation.id}`;
    return query.isSuccess
      ? query.data[key]
      : getCachedCalendarInvitations(props.threadId)?.[key];
  };
  const state = (): InvitationResolution => {
    if (!calendarEnabled()) return { kind: 'unavailable' };
    if (query.isPending) return { kind: 'loading' };
    const current = wire();
    if (!current && query.isError) return { kind: 'unavailable' };
    const resolution = invitationResolution(props.invitation, current);
    // Keep last-known details after a failed refresh, but withhold actions.
    return query.isError && resolution.kind === 'resolved'
      ? { ...resolution, canRespond: false, canJoin: false }
      : resolution;
  };
  const openTarget = (): CalendarInvitationOpenTarget | undefined => {
    const current = calendarEnabled() && query.isSuccess ? wire() : undefined;
    return current?.kind === 'resolved'
      ? {
          eventId: current.event.id,
          occurrenceKey: current.occurrence.occurrenceKey,
          time: current.occurrence.time,
        }
      : undefined;
  };
  const resolved = () => {
    const value = state();
    return value.kind === 'resolved' ? value : undefined;
  };
  const rsvp = createCalendarRsvpController(() => {
    const value = resolved();
    return value?.canRespond ? value : undefined;
  });
  return (
    <>
      <CalendarInviteCard
        invitation={props.invitation}
        hour12={props.hour12}
        actions={{
          get resolution() {
            return state();
          },
          get pending() {
            return rsvp.pending();
          },
          get error() {
            return rsvp.error();
          },
          respond: rsvp.respond,
          get notice() {
            return query.isError
              ? resolved()
                ? 'Calendar unavailable. Showing last-known details and response.'
                : 'Calendar unavailable. Showing saved invitation details.'
              : undefined;
          },
          get retryCalendar() {
            return query.isError
              ? () => {
                  void query.refetch();
                }
              : undefined;
          },
          get connectCalendar() {
            return calendarEnabled()
              ? () => {
                  void startAddInbox({ scopes: 'gmail_and_calendar' });
                }
              : undefined;
          },
          openExternal: (url) => {
            openExternalUrl(url);
          },
          get openCalendar() {
            const target = openTarget();
            return target && props.openCalendar
              ? () => props.openCalendar?.(target)
              : undefined;
          },
          get showDay() {
            return resolved() ? toggleDay : undefined;
          },
          get dayExpanded() {
            return showDay();
          },
        }}
      />
      <EventRsvpScopeDialog
        open={rsvp.scopeOpen()}
        scope={rsvp.scope()}
        onScopeChange={rsvp.setScope}
        onClose={rsvp.closeScope}
        onConfirm={rsvp.confirmScope}
      />
      <Show when={showDay() && resolved()}>
        {(current) => (
          <Suspense fallback={<p role="status">Loading your day…</p>}>
            <CalendarInvitationDay
              invitation={displayedInvitation(props.invitation, current())}
              eventId={current().eventId}
              occurrenceKey={current().occurrenceKey}
              hour12={props.hour12}
              onClose={closeDay}
            />
          </Suspense>
        )}
      </Show>
    </>
  );
}
