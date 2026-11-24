import { createSignal } from 'solid-js';

/**
 * The login session, apart from what each new one resets (`account-scope.ts`),
 * so code that must not load the query client can read it.
 */
export const [accountSession, setAccountSession] = createSignal<{
  epoch: number;
  /** A sign-in has not said who it is. */
  pending: boolean;
  /** Who a sign-in of this page said it is. */
  userId?: string;
}>({ epoch: 0, pending: false });

/** The login session, for work that has no user id to capture: a new login
 * changes it, even to the same account, and a failed identity read doesn't. */
export function queryAccountSession(): number {
  return accountSession().epoch;
}

/**
 * Whether a write asked for now is the signed-in person's: not while a sign-in
 * has not said who it is, nor, when the write says whose it is, of someone
 * else. Refuses nothing until a sign-in replaces the session the page began.
 */
export function maySignedInUserWrite(userId: string | undefined): boolean {
  const { pending, userId: signedIn } = accountSession();
  if (pending) return false;
  return !signedIn || userId === undefined || signedIn === userId;
}
