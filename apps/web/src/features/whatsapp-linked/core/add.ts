import { match } from 'ts-pattern';
import { type CannotAdd, cannotAddMessage } from './chat';

/** Why adding a group did not happen, in the page's vocabulary. */
export type AddRefusal =
  | { reason: 'not-allowed' }
  | { reason: 'gone' }
  | { reason: 'already-added' }
  | { reason: 'disconnected' }
  | { reason: 'rate-limited' }
  /** DSS's reason this chat can't be in Macro. */
  | { reason: 'cannot-add'; why: CannotAdd }
  | { reason: 'unavailable' }
  /** DSS is behind on this account's WhatsApp work. */
  | { reason: 'busy' }
  /** DSS failed in a way retrying may not fix. */
  | { reason: 'server-error' }
  /** DSS rejected the request; its wording says why. */
  | { reason: 'rejected'; detail: string }
  | { reason: 'signed-out' }
  | { reason: 'unreachable' };

export type AddFailure = { kind: 'add-failed' } & AddRefusal;

/** Specific words for each refusal; never a catch-all. */
export function addFailureMessage(failure: AddRefusal): string {
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
      { reason: 'rate-limited' },
      () => 'Too many requests at once. Wait a second, then add it again.'
    )
    .with({ reason: 'cannot-add' }, ({ why }) => `${cannotAddMessage(why)}.`)
    .with(
      { reason: 'busy' },
      () => 'Macro is catching up with your WhatsApp. Try again in a moment.'
    )
    .with(
      { reason: 'server-error' },
      () =>
        'Macro hit an error adding this chat. If it keeps happening, tell us.'
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
