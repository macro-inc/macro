import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { match, P } from 'ts-pattern';

type LoginSuccessMessage = {
  type: 'login-success';
  /**
   * Publish time. Makes each payload unique so the bus's storage fallback
   * fires (see `cross-tab-bus.ts`).
   */
  sentAt: number;
};

const authBus = createCrossTabBus<LoginSuccessMessage>({
  channelName: 'auth',
  storageKey: 'macro.auth-login-success',
  parse: (value) =>
    match(value)
      .with(
        { type: 'login-success', sentAt: P.number },
        ({ type, sentAt }) => ({
          type,
          sentAt,
        })
      )
      .otherwise(() => null),
});

/**
 * Announces a completed login to sibling tabs, e.g. from the login popup or
 * an email-link callback page, so an opener waiting on authentication can
 * proceed.
 */
export function publishLoginSuccess() {
  authBus.publish({ type: 'login-success', sentAt: Date.now() });
}

/**
 * Subscribes to login announcements originating in this tab or a sibling
 * (see `publishLoginSuccess`). Returns an unsubscribe function.
 */
export function subscribeToLoginSuccess(handler: () => void) {
  return authBus.subscribe(handler);
}
