import { queryReadyGate } from '@queries/gate';
import type { Loadable } from '../context/onboarding-context';

/** Adapt query state to the onboarding contract without suspending the form. */
export function loadableQuery<T, R>(
  query: { isPending: boolean; isError: boolean; data: T | undefined },
  map: (data: T) => R
): Loadable<R> {
  // Retained data wins over a background error; pending resources are never read.
  if (queryReadyGate(query)) return { t: 'ready', value: map(query.data) };
  if (query.isError) return { t: 'error' };
  return { t: 'loading' };
}
