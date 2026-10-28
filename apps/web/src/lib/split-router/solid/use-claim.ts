import { type Accessor, onCleanup } from 'solid-js';
import type { ClaimHolder } from '../router/claims';
import { usePaneContext, useSplitRouter } from './context';

/**
 * Registers a resource this view shows outside a pane route, such as an
 * inline preview, so opening it elsewhere activates this pane instead.
 */
export function useClaim(claim: Accessor<string | undefined>) {
  const router = useSplitRouter();
  const scope = usePaneContext();
  const owner = Symbol('split-router.inline-claim');

  const holders = (): ClaimHolder[] => {
    const value = claim();
    if (!value) return [];

    const pane = scope.pane();
    const holder: ClaimHolder = {
      owner,
      pane,
      claim: value,
      activate: () => router.activatePane(pane),
    };

    return [holder];
  };

  onCleanup(router.claims.register(holders));

  return {
    /** Who else shows `candidate`, if anyone outside this pane does. */
    heldElsewhere: (candidate: string): ClaimHolder | undefined =>
      router.claims.holderOf(candidate, scope.pane()),
  };
}
