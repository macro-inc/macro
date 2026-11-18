import { createSignal } from 'solid-js';

// A work hint, not a directory or query-history cache. A running scan finishes
// before the next coalesced refresh; events never rewind its cursor.
export const [contactRefreshRevision, requestContactRefresh] = (() => {
  const [revision, setRevision] = createSignal(0);
  return [revision, () => setRevision((value) => value + 1)] as const;
})();
