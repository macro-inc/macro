import { match } from 'ts-pattern';

/** Why adding a group did not happen, in the page's vocabulary. */
export type AdoptRefusal =
  | { reason: 'not-allowed' }
  | { reason: 'gone' }
  | { reason: 'already-added' }
  | { reason: 'disconnected' }
  | { reason: 'turned-off' }
  | { reason: 'rate-limited' }
  | { reason: 'unavailable' }
  /** DSS rejected the request; its wording says why. */
  | { reason: 'rejected'; detail: string }
  | { reason: 'signed-out' }
  | { reason: 'unreachable' };

export type AdoptFailure = { kind: 'adopt-failed' } & AdoptRefusal;

/** Specific words for each refusal; never a catch-all. */
export function adoptFailureMessage(failure: AdoptRefusal): string {
  return match(failure)
    .with(
      { reason: 'not-allowed' },
      () =>
        "Your WhatsApp isn't allowed to add this chat. Check that you're still in it."
    )
    .with({ reason: 'gone' }, () => 'This chat is no longer on your WhatsApp.')
    .with({ reason: 'already-added' }, () => 'This chat is already in Macro.')
    .with(
      { reason: 'disconnected' },
      () => 'Your WhatsApp is disconnected. Reconnect it, then add the chat.'
    )
    .with(
      { reason: 'turned-off' },
      () => 'Adding WhatsApp chats is turned off.'
    )
    .with(
      { reason: 'rate-limited' },
      () => 'Too many requests at once. Wait a second, then add it again.'
    )
    .with(
      { reason: 'unavailable' },
      () => 'WhatsApp is temporarily unavailable. Try again in a moment.'
    )
    .with(
      { reason: 'rejected' },
      ({ detail }) => `WhatsApp didn't accept this chat: ${detail}.`
    )
    .with(
      { reason: 'signed-out' },
      () => 'Your Macro session expired. Sign in again to add this chat.'
    )
    .with(
      { reason: 'unreachable' },
      () => "Couldn't reach Macro. Check your connection and try again."
    )
    .exhaustive();
}
