import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { match } from 'ts-pattern';

type LoginSuccessMessage = {
  type: 'login-success';
  /**
   * Publish time. Makes each payload unique so the bus's storage fallback
   * fires (see `cross-tab-bus.ts`). Optional so payloads from tabs still on
   * a pre-bus bundle, which omit it, parse.
   */
  sentAt?: number;
};

const authBus = createCrossTabBus<LoginSuccessMessage>({
  channelName: 'auth',
  storageKey: 'macro.auth-login-success',
  parse: (value) =>
    match(value)
      .with({ type: 'login-success' }, ({ type }) => ({ type }))
      .otherwise(() => null),
});

/**
 * Announces a completed login to sibling tabs, e.g. from the login popup or
 * an email-link callback page. Subscribe with `authBus` here if a waiter is
 * ever needed; today the channel is publish-only.
 */
export function publishLoginSuccess() {
  authBus.publish({ type: 'login-success', sentAt: Date.now() });
}
