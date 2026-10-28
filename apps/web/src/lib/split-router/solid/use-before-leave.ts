import { onCleanup } from 'solid-js';
import type { LeaveGuard, LeaveGuardOptions } from '../router/types';
import { usePaneContext, useSplitRouter } from './context';

/**
 * Runs before a navigation would unmount this view or close its pane.
 * Opt into search namespaces to also protect updates that keep this view mounted.
 * Return false, or a Promise of false, to keep the pane where it is.
 * Stage commit-only side effects with context.onCommit; cleanup is not a commit.
 */
export function useBeforeLeave(
  guard: LeaveGuard,
  options?: LeaveGuardOptions
): void {
  const router = useSplitRouter();
  const scope = usePaneContext();
  const pane = scope.pane();
  const viewDepth = scope.depth() - 1;

  onCleanup(router.registerGuard(pane, viewDepth, guard, options));
}
