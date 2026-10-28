import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  isForwardRecipientRefusal,
  useForwardCalendarEventMutation,
} from '@queries/calendar/forward';
import {
  type InviteCalendarEventGuestsArgs,
  isGuestInviteRefused,
  isGuestListHiddenRefusal,
  useInviteCalendarEventGuestsMutation,
} from '@queries/calendar/mutations';
import type { CalendarInviteScope } from '@service-email/client';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import type { CalendarEvent } from '../types';
import { eventForwardSummary } from '../utils/event-forward-summary';
import {
  canForwardInvitation,
  FORWARD_INVITATION_INSTEAD,
  FORWARDED_INVITATION_NOTE,
  GUEST_INVITES_RESTRICTED,
  GUEST_LIST_HIDDEN,
  guestInvitesRestrictedReason,
} from '../utils/event-guest-editing';
import { useCalendarPreferences } from '../utils/preferences';

/** Guests an editor sends an invitation to, with the names its toast uses. */
export interface GuestInvitation {
  guests: { email: string; name: string; optional: boolean }[];
  scope: CalendarInviteScope;
}

export function invitationSentMessage(guests: readonly { name: string }[]) {
  return guests.length === 1
    ? `Invitation sent to ${guests[0]?.name}`
    : `Invitations sent to ${guests.length} people`;
}

/** People a guest forwards the invitation to, with the names its toast uses. */
export interface InvitationForward {
  recipients: { email: string; name: string }[];
}

export function invitationForwardedMessage(
  recipients: readonly { name: string }[]
) {
  return recipients.length === 1
    ? `Invitation forwarded to ${recipients[0]?.name}`
    : `Invitation forwarded to ${recipients.length} people`;
}

/**
 * Inviting guests from event details. The editor closes as soon as the
 * invitation goes out, while the mutation shows the new guests as unanswered.
 * The outcome is announced once the provider answers, since that takes
 * seconds. A refusal means the organizer does not let guests invite, or
 * hides the guest list, which switches the details to that explanation.
 * A guest who cannot invite forwards the invitation instead: its editor
 * closes the same way, and the outcome is announced once the email is
 * accepted for sending, with Retry when it failed for another reason than
 * its recipients.
 */
export function createGuestInviteController(
  event: Accessor<CalendarEvent>,
  enabled: Accessor<boolean>,
  forwardEnabled: Accessor<boolean>
) {
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [forwardEditorOpen, setForwardEditorOpen] = createSignal(false);
  const [refusal, setRefusal] = createSignal<string>();
  const mutation = useInviteCalendarEventGuestsMutation();
  const forwardMutation = useForwardCalendarEventMutation();
  const [preferences] = useCalendarPreferences();

  const deliver = async (
    args: InviteCalendarEventGuestsArgs,
    sentMessage: string
  ) => {
    const result = await ResultAsync.fromPromise(
      mutation.mutateAsync(args),
      (error) => error
    );
    if (result.isOk()) {
      if (result.value === 'queued') {
        toast.alert('Invitations will be sent when you are back online');
        return;
      }
      toast.success(sentMessage);
      return;
    }
    const refusedWith = isGuestInviteRefused(result.error)
      ? GUEST_INVITES_RESTRICTED
      : isGuestListHiddenRefusal(result.error)
        ? GUEST_LIST_HIDDEN
        : undefined;
    if (refusedWith) {
      setRefusal(refusedWith);
      toast.failure(refusedWith);
      return;
    }
    toast.failure('Could not send invitations', {
      subtext: result.error instanceof Error ? result.error.message : undefined,
    });
  };

  /**
   * A refused invitation means the guest list cannot grow after all, even
   * before the synced event says so.
   */
  const canForward = () => {
    const current = event();
    if (!forwardEnabled() || current.isCancelled) return false;
    if (canForwardInvitation(current)) return true;
    return (
      refusal() !== undefined &&
      !current.isReadOnly &&
      !current.teamProjection &&
      !current.isSnapshot
    );
  };

  const deliverForward = async (
    current: CalendarEvent,
    forward: InvitationForward
  ) => {
    const result = await ResultAsync.fromPromise(
      forwardMutation.mutateAsync({
        eventId: current.eventId,
        recipients: forward.recipients.map(({ email, name }) => ({
          email,
          name: name === email ? undefined : name,
        })),
        bodyText: `${eventForwardSummary(current, preferences.timeFormat)}\n\n${FORWARDED_INVITATION_NOTE}`,
      }),
      (error) => error
    );
    if (result.isOk()) {
      toast.success(invitationForwardedMessage(forward.recipients));
      return;
    }
    if (isForwardRecipientRefusal(result.error)) {
      toast.failure('Could not forward the invitation', {
        subtext:
          result.error instanceof Error ? result.error.message : undefined,
      });
      return;
    }
    toast.failure('Could not forward the invitation', {
      actions: [
        {
          label: 'Retry',
          onClick: () => sendForward(current, forward),
        },
      ],
    });
  };

  const sendForward = (current: CalendarEvent, forward: InvitationForward) => {
    if (forward.recipients.length === 0) return;
    if (!navigator.onLine) {
      toast.failure('You are offline. Reconnect to forward the invitation.');
      return;
    }
    setForwardEditorOpen(false);
    fireAndForget(
      deliverForward(current, forward),
      'calendar-invitation-forward'
    );
  };

  return {
    editorOpen,
    setEditorOpen,
    forwardEditorOpen,
    setForwardEditorOpen,
    canForward,
    /** Forward the invitation to people the guest list won't name. */
    forward: (forward: InvitationForward) => sendForward(event(), forward),
    canInvite: () => {
      const current = event();
      return (
        enabled() &&
        !refusal() &&
        !current.isReadOnly &&
        !current.isCancelled &&
        !current.teamProjection &&
        current.viewerCan.inviteGuests
      );
    },
    /**
     * Why the viewer cannot add guests, shown above the guest list, and
     * what they can do instead when the invitation can be forwarded.
     */
    restrictedReason: () => {
      const reason = refusal() ?? guestInvitesRestrictedReason(event());
      if (!reason) return undefined;
      return canForward() ? `${reason} ${FORWARD_INVITATION_INSTEAD}` : reason;
    },
    send: (invitation: GuestInvitation) => {
      if (invitation.guests.length === 0) return;
      if (!navigator.onLine) {
        toast.failure('You are offline. Reconnect to send invitations.');
        return;
      }
      const current = event();
      const oneOccurrence = invitation.scope === 'this_event';
      setEditorOpen(false);
      fireAndForget(
        deliver(
          {
            eventId: current.eventId,
            calendarId: current.calendarId,
            guests: invitation.guests.map(({ email, optional }) => ({
              email,
              optional,
            })),
            scope: invitation.scope,
            recurrenceId: oneOccurrence
              ? (current.recurrenceId ?? current.occurrenceKey)
              : undefined,
            occurrenceKey: oneOccurrence ? current.occurrenceKey : undefined,
          },
          invitationSentMessage(invitation.guests)
        ),
        'calendar-guest-invites'
      );
    },
  };
}

export type GuestInviteController = ReturnType<
  typeof createGuestInviteController
>;
