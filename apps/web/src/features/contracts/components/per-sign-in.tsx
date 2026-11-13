import { createMemo, type JSX, Show } from 'solid-js';

/** A confirmed sign-in: the account, and which login of it this is. */
export type SignIn = { userId: string; session: number };

/**
 * Mounts its content once per confirmed sign-in. While a new login is still
 * being confirmed there is no sign-in, so nothing of the previous account
 * stays on screen; the next one gets content of its own.
 */
export function PerSignIn(props: {
  signIn: SignIn | undefined;
  children: (userId: string) => JSX.Element;
}) {
  const signIn = createMemo(() => props.signIn, undefined, {
    equals: (a, b) => a?.userId === b?.userId && a?.session === b?.session,
  });

  return (
    <Show when={signIn()} keyed>
      {(current) => props.children(current.userId)}
    </Show>
  );
}
