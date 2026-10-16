import { decodeBase64Utf8 } from '@app/features/email-compose/core/decode-base64';
import {
  CreateCalendarEvent,
  SendEmail,
} from '@service-cognition/generated/tools/schemas';
import * as EmailValidator from 'email-validator';
import type { Review, ReviewItem } from '../core/review';

/** Preflight every selected draft before a batch can start external actions. */
export function validateReviewDraft(
  item: ReviewItem,
  kind: Review['kind']
): string | undefined {
  if (kind === 'email') {
    const parsed = SendEmail.safeParse(item.draft);
    if (!parsed.success)
      return 'This email has invalid fields. Review it before sending.';
    const draft = parsed.data;
    if (draft.to.length === 0) return 'Add at least one recipient.';
    if (
      [...draft.to, ...(draft.cc ?? []), ...(draft.bcc ?? [])].some(
        (recipient) => !EmailValidator.validate(recipient.email)
      )
    )
      return 'Correct the email addresses before sending.';
    const decoded = decodeBase64Utf8(draft.body);
    const content =
      decoded !== draft.body && /^\s*</.test(decoded)
        ? new DOMParser().parseFromString(decoded, 'text/html').body.textContent
        : draft.body;
    if (!content?.trim()) return 'Write a message before sending.';
  } else if (kind === 'calendar') {
    const parsed = CreateCalendarEvent.safeParse(item.draft);
    if (!parsed.success)
      return 'This event has invalid fields. Review it before creating.';
    const draft = parsed.data;
    if (!draft.title.trim()) return 'Give this event a title.';
    const time = draft.time;
    if (!time) return 'Choose the event start and end.';
    const start = Date.parse(
      time.kind === 'timed' ? time.startsAt : time.startDate
    );
    const end = Date.parse(time.kind === 'timed' ? time.endsAt : time.endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return 'The event must end after it starts.';
    if (draft.addMacroCall && draft.addGoogleMeet)
      return 'Choose either a Macro call or Google Meet.';
    if (
      (draft.attendees ?? []).some(
        (guest) => !EmailValidator.validate(guest.email)
      )
    )
      return 'Correct the guest email addresses before creating.';
  }
}
