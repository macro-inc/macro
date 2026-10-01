import { onCleanup } from 'solid-js';
import type { LeaveGuard } from '../router/types';
import { usePaneContext, useSplitRouter } from './context';

/**
 * Runs before a navigation would unmount this view or close its pane.
 * Return false, or a Promise of false, to keep the pane where it is.
 */
export function useBeforeLeave(guard: LeaveGuard): void {
  const router = useSplitRouter();
  const scope = usePaneContext();
  const pane = scope.pane();
  const viewDepth = scope.depth() - 1;

  onCleanup(router.registerGuard(pane, viewDepth, guard));
}
