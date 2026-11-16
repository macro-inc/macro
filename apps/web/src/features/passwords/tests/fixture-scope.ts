import type { PasswordScope } from '../context/passwords-context';

/** A viewer scope a test can end, as a sign-in to another account would. */
export function createFixtureScope(key = 'fixture-account:1:fixture-team') {
  let current = true;
  const scope: PasswordScope = { key, isCurrent: () => current };
  return {
    scope,
    end() {
      current = false;
    },
  };
}

export const FIXTURE_SCOPE = createFixtureScope().scope;
