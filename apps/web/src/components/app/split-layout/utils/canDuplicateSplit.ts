import { claimOf, type PaneId, type SplitRouter } from '@app/lib/split-router';
import type { SplitContent } from '../layoutManager';

/**
 * Whether Duplicate split can copy what `pane` shows. Only shells can be
 * duplicated: an entity opens once per tab, including one a shell shows
 * inside it (a Mail thread, a task), and Mail's copy would fall back to its
 * list. Shells claim in the `component` namespace; every other claim is an
 * entity.
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
