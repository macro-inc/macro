import { type Accessor, createEffect, on } from 'solid-js';
import type { AuthContext } from '../context/auth-context';

/**
 * Redeem the session code an SSO return put on the URL.
 *
 * The code does not always arrive with the first render. The desktop app is
 * already parked on the signed-out route when the hosted flow hands back
 * `macro:///welcome?token=...`, so the deep link is a query-only navigation
 * that leaves this view mounted — reading the code once at setup would miss
 * it and leave the app signed out. Each code is redeemed at most once.
 */
export function redeemSessionToken(
  context: Pick<AuthContext, 'redeemSessionToken' | 'notifyFailure'>,
  token: Accessor<string | undefined>
) {
  const attempted = new Set<string>();
  createEffect(
    on(token, (code) => {
      if (!code || attempted.has(code)) return;
      attempted.add(code);
      void context.redeemSessionToken(code).then((ok) => {
        if (!ok) context.notifyFailure('Sign-in failed. Please try again.');
      });
    })
  );
}

/** Tell analytics who signed in, once per user. */
export function createSessionIdentity(
  context: Pick<AuthContext, 'session' | 'identify'>
) {
  createEffect(
    on(
      () => {
        const session = context.session();
        return session.t === 'signed-in' ? session.user : undefined;
      },
      (user) => {
        if (user) context.identify(user);
      }
    )
  );
}
