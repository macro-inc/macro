import { toast } from '@core/component/Toast/Toast';
import { useAddInboxFlow } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import {
  getCachedCalendarInvitations,
  useCalendarInvitationsQuery,
  useCopyCalendarInvitationMutation,
} from '@queries/calendar/invitations';
import type { EventTime } from '@service-email/generated/schemas/eventTime';
import { createSignal, Show, Suspense } from 'solid-js';
import { EventRsvpScopeDialog } from '../calendar/components/EventRsvpScopeDialog';
import { createCalendarRsvpController } from '../calendar/hooks/create-calendar-rsvp-controller';
import {
  useCalendarAddSharedEventFlag,
  useCalendarUiFlag,
} from '../calendar/hooks/use-calendar-ui-flag';
import {
  AddToCalendarButton,
  toastAddToCalendarFailure,
} from '../calendar-view/components/AddToCalendarButton';
import { CalendarInviteCard } from '../email-message/components/calendar-invite-card';
import {
  type CalendarInvitation,
  displayedInvitation,
  type InvitationResolution,
  invitationCanBeAdded,
} from '../email-message/core/calendar-invitation';
import { CalendarInvitationDay } from './calendar-invitation-day';
import { invitationResolution } from './queries/calendar-invitation';

export type CalendarInvitationOpenTarget = {
  eventId: string;
  occurrenceKey: string;
  time: EventTime;
  /** Open Calendar beside the email unless a Calendar split is already open. */
  openInNewSplit?: boolean;
};

export function EmailCalendarInvitation(props: {
  threadId: string;
  messageId: string;
  invitation: CalendarInvitation;
  hour12: boolean;
  openCalendar?: (target: CalendarInvitationOpenTarget) => void;
  /** Called before Open in calendar leaves the email. */
  onNavigate?: () => void;
  /** The card is shown inside the calendar file it came from. */
  inCalendarFile?: boolean;
}) {
  const calendarEnabled = useCalendarUiFlag();
  const saved = () => (
    <CalendarInviteCard
      invitation={props.invitation}
      hour12={props.hour12}
      inCalendarFile={props.inCalendarFile}
    />
  );
  // Without the calendar UI, the saved invitation renders with no calendar lookup.
  return (
    <Show when={calendarEnabled()} fallback={saved()}>
      <Suspense fallback={saved()}>
        <ConnectedInvitation {...props} />
      </Suspense>
    </Show>
  );
}
function ConnectedInvitation(
  props: Parameters<typeof EmailCalendarInvitation>[0]
) {
  const startAddInbox = useAddInboxFlow();
  const query = useCalendarInvitationsQuery(() => props.threadId);
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
    const current = query.isSuccess ? wire() : undefined;
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
  const addSharedEvent = useCalendarAddSharedEventFlag();
  // A forwarded event the viewer does not hold yet is added as a snapshot,
  // like a channel-shared one; once it lands the card resolves to it.
  const copy = useCopyCalendarInvitationMutation({
    onSuccess: () => toast.success('Added to your calendar'),
    onError: toastAddToCalendarFailure,
  });
  // Like the response actions, adding waits for a calendar check that worked.
  const canAdd = () =>
    addSharedEvent() &&
    !query.isError &&
    state().kind === 'no_match' &&
    invitationCanBeAdded(props.invitation);
  return (
    <>
      <CalendarInviteCard
        invitation={props.invitation}
        hour12={props.hour12}
        inCalendarFile={props.inCalendarFile}
        addToCalendar={
          <Show when={canAdd()}>
            <AddToCalendarButton
              size="md"
              pending={copy.isPending}
              onAdd={(calendarId) =>
                copy.mutate({
                  threadId: props.threadId,
                  messageId: props.messageId,
                  invitationId: props.invitation.id,
                  calendarId,
                })
              }
            />
          </Show>
        }
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
          retryCalendar: () => {
            fireAndForget(query.refetch(), 'email-thread');
          },
          connectCalendar: () => {
            fireAndForget(
              startAddInbox({ scopes: 'gmail_and_calendar' }),
              'add-inbox'
            );
          },
          openExternal: (url) => {
            openExternalUrl(url);
          },
          get openCalendar() {
            const target = openTarget();
            const open = props.openCalendar;
            const leave = props.onNavigate;
            return target && open
              ? (options: { openInNewSplit: boolean }) => {
                  leave?.();
                  open({ ...target, openInNewSplit: options.openInNewSplit });
                }
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
