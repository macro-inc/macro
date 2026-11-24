import { createSignal } from 'solid-js';

/**
 * The login session, apart from what each new one resets (`account-scope.ts`),
 * so code that must not load the query client can read it.
 */
export const [accountSession, setAccountSession] = createSignal({
  epoch: 0,
  pending: false,
});

/** The login session, for work that has no user id to capture: a new login
 * changes it, even to the same account, and a failed identity read doesn't. */
export function queryAccountSession(): number {
  return accountSession().epoch;
}
