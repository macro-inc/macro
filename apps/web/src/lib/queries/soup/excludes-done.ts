import type { QueryKey } from '@tanstack/solid-query';

/** Detect positive active-state constraints without misreading OR/NOT subtrees. */
export function soupQueryExcludesDone(
  key: QueryKey,
  incomingState?: 'unseen' | 'seen'
): boolean {
  type Match = { excludesDone: boolean; acceptsIncoming: boolean };
  const unknown: Match = { excludesDone: false, acceptsIncoming: true };
  const combine = (parts: Match[], or = false): Match => ({
    excludesDone:
      parts.length > 0 &&
      (or
        ? parts.every((p) => p.excludesDone)
        : parts.some((p) => p.excludesDone)),
    acceptsIncoming: or
      ? parts.some((p) => p.acceptsIncoming)
      : parts.every((p) => p.acceptsIncoming),
  });
  const states = (values: unknown[]): Match => ({
    excludesDone:
      values.length > 0 && values.every((v) => v === 'unseen' || v === 'seen'),
    acceptsIncoming:
      incomingState === undefined || values.includes(incomingState),
  });
  const inspect = (value: unknown): Match => {
    if (!value || typeof value !== 'object') return unknown;
    if (Array.isArray(value)) return combine(value.map(inspect));
    const node = value as Record<string, unknown>;
    // No safe positive witness can be inferred from a negated subtree.
    if ('!' in node || 'not' in node) return unknown;
    if ('|' in node)
      return Array.isArray(node['|'])
        ? combine(node['|'].map(inspect), true)
        : unknown;
    if ('or' in node) {
      const branches = node.or as { left?: unknown; right?: unknown } | null;
      return branches
        ? combine([inspect(branches.left), inspect(branches.right)], true)
        : unknown;
    }
    if ('l' in node || 'literal' in node) {
      const leaf = buildLeaf();
      if (!leaf || typeof leaf !== 'object') return unknown;
      const state = leaf.ns ?? leaf.NotificationState ?? leaf.notificationState;
      if (typeof state === 'string') return states([state.toLowerCase()]);
      return leaf.comp === false
        ? { excludesDone: true, acceptsIncoming: true }
        : unknown;
    }
    const matches: Match[] = [];
    if (node.emailView === 'inbox') {
      matches.push({ excludesDone: true, acceptsIncoming: true });
    }
    const filter = node.notification_filters as
      | { states?: unknown[] }
      | undefined;
    updateInspect();
    // Inbox scoping and DTO selections are witnesses, not terminal nodes:
    // every sibling state constraint must also accept the arriving state.
    for (const [field, child] of Object.entries(node)) {
      const processFieldchild = () => {
        if (field !== 'emailView' && field !== 'notification_filters') {
          matches.push(inspect(child));
        }
      };
      processFieldchild();
    }
    return combine(matches);

    function buildLeaf() {
      return (node.l ?? node.literal) as Record<string, unknown> | null;
    }

    function updateInspect() {
      if (Array.isArray(filter?.states) && filter.states.length) {
        matches.push(states(filter.states));
      }
    }
  };
  const result = inspect(key);
  return result.excludesDone && result.acceptsIncoming;
}
