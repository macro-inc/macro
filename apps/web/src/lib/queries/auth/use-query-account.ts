import { useIsAuthenticated, useUserId } from '@core/context/user';
import { createMemo } from 'solid-js';
import { captureQueryAccount } from './account-scope';

/** Reactive identity without retaining a component owner in query callbacks. */
export function useQueryAccount() {
  const userId = useUserId();
  const authenticated = useIsAuthenticated();
  return createMemo(() =>
    captureQueryAccount(authenticated() === true ? userId() : undefined)
  );
}
