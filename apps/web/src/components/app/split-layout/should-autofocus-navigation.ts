import type { NavigationCause, ReferredFrom } from './layoutManager';

/** Content claims keyboard focus only after a command jump or creation. */
export function shouldAutofocusNavigation(
  referredFrom: ReferredFrom | undefined,
  cause: NavigationCause
) {
  return (
    (cause === 'fresh' || cause === 'replace') &&
    (referredFrom === 'kommand-menu' || referredFrom === 'launcher')
  );
}
