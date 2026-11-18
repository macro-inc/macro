import { match } from 'ts-pattern';
import { type AddRefusal, addFailureMessage } from './add';

/** WhatsApp numbers: a country code first, 7 to 15 digits in all. */
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * A typed phone number in E.164 (`+<country code><number>`), ignoring
 * spaces, dashes, dots and brackets; `00` counts as `+`. Undefined when it
 * isn't a full international number.
 */
export function normalizePhoneNumber(typed: string): string | undefined {
  const compact = typed.trim().replace(/[\s().-]/g, '');
  const international = compact.startsWith('00')
    ? `+${compact.slice(2)}`
    : compact;
  return E164.test(international) ? international : undefined;
}

/** Why starting a chat with a number did not open one. */
export type NewChatFailure =
  | { reason: 'invalid-number' }
  | { reason: 'not-on-whatsapp'; phoneNumber: string }
  /** WhatsApp did not answer in time, or the connection is down. */
  | { reason: 'no-answer' }
  | { reason: 'lookup-refused'; refusal: AddRefusal }
  | { reason: 'add-refused'; refusal: AddRefusal };

/** Specific words for each failure; never a catch-all. */
export function newChatFailureMessage(failure: NewChatFailure): string {
  return match(failure)
    .with(
      { reason: 'invalid-number' },
      () => 'Enter the full number, starting with + and the country code.'
    )
    .with(
      { reason: 'not-on-whatsapp' },
      ({ phoneNumber }) => `${phoneNumber} isn't on WhatsApp.`
    )
    .with(
      { reason: 'no-answer' },
      () =>
        "WhatsApp didn't answer. Check that your phone is online, then try again."
    )
    .with(
      { reason: 'lookup-refused', refusal: { reason: 'rate-limited' } },
      () =>
        "You've looked up many numbers recently. WhatsApp blocks accounts that check too many, so try again in an hour."
    )
    .with({ reason: 'lookup-refused' }, { reason: 'add-refused' }, (failed) =>
      addFailureMessage(failed.refusal)
    )
    .exhaustive();
}
