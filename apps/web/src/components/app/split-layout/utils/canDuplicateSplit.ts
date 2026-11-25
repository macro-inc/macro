import { claimOf, type PaneId, type SplitRouter } from '@app/lib/split-router';
import type { SplitContent } from '../layoutManager';

/**
 * Whether Duplicate split can copy what `pane` shows. Only views can be
 * duplicated: an entity opens once per tab, so a view showing one inside it
 * (a Mail thread, a task) would open in the copy without it. Views claim in
 * the `component` namespace; every other claim is an entity.
 */
export function canDuplicateSplit(
  router: SplitRouter,
  pane: PaneId,
  content: SplitContent
) {
  if (content.type !== 'component') return false;

  const entry = router.entry(pane);
  if (!entry) return false;

  const claim = claimOf(router.routes, entry.location.route);
  if (claim === undefined) return true;

  return claim.startsWith('component:');
}
