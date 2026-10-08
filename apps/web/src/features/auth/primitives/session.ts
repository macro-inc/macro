import { createEffect, on } from 'solid-js';
import type { AuthContext } from '../context/auth-context';

/** Redeem the session code an SSO return put on the URL. */
export function redeemSessionToken(
  context: Pick<AuthContext, 'redeemSessionToken' | 'notifyFailure'>,
  token: string | undefined
) {
  if (!token) return;
  void context.redeemSessionToken(token).then((ok) => {
    if (!ok) context.notifyFailure('Sign-in failed. Please try again.');
  });
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
