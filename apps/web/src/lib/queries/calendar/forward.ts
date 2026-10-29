import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import type { MutationCallbacks } from '@queries/utils';
import { emailClient } from '@service-email/client';
import { ForwardCalendarEventErrorCode } from '@service-email/generated/schemas/forwardCalendarEventErrorCode';
import type { ForwardCalendarEventResponse } from '@service-email/generated/schemas/forwardCalendarEventResponse';
import { useMutation } from '@tanstack/solid-query';

export interface ForwardCalendarEventArgs {
  /** The viewer's own copy of the event. */
  eventId: string;
  recipients: { email: string; name?: string }[];
  /** The email's plain-text body. */
  bodyText: string;
}

/** Whether the server refused the recipients, so retrying cannot help. */
export function isForwardRecipientRefusal(error: unknown): boolean {
  return thrownResultErrorHasCode(
    error,
    ForwardCalendarEventErrorCode.invalid_recipients
  );
}

/** Span outcome of a failed forward. */
function forwardFailureOutcome(error: unknown) {
  if (isForwardRecipientRefusal(error)) return 'invalid_recipients';
  if (thrownResultErrorHasCode(error, ForwardCalendarEventErrorCode.not_found))
    return 'not_found';
  if (
    thrownResultErrorHasCode(
      error,
      ForwardCalendarEventErrorCode.inbox_unavailable
    )
  )
    return 'inbox_unavailable';
  return 'failed';
}

async function forwardCalendarEvent(
  args: ForwardCalendarEventArgs
): Promise<ForwardCalendarEventResponse> {
  return Telemetry.span('calendar.forward_invitation', async (span) => {
    span.setAttr('calendar.event_id', args.eventId);
    span.setAttr('calendar.forward.recipient_count', args.recipients.length);
    try {
      const sent = await throwOnErr(() =>
        emailClient.forwardCalendarEvent(args.eventId, {
          to: args.recipients,
          bodyText: args.bodyText,
        })
      );
      span.setAttr('email.message_id', sent.messageId);
      span.setAttr('calendar.forward.outcome', 'sent');
      return sent;
    } catch (error) {
      const outcome = forwardFailureOutcome(error);
      span.setAttr('calendar.forward.outcome', outcome);
      // Provider messages can quote addresses; record only the category.
      span.error('Forwarding the invitation failed');
      throw error;
    }
  });
}

type ForwardCallbacks = MutationCallbacks<
  ForwardCalendarEventResponse,
  Error,
  ForwardCalendarEventArgs,
  unknown
>;

/**
 * Emails the event's .ics to people the organizer's guest list does not
 * name, from the inbox holding the viewer's copy. Nothing about the event
 * changes, so no cache needs refreshing.
 */
export function useForwardCalendarEventMutation(callbacks?: ForwardCallbacks) {
  return useMutation(() => ({
    mutationFn: forwardCalendarEvent,
    ...callbacks,
  }));
}
