import { createQueueOwners } from '@graphql-cache/exchange/queue-owners';

/**
 * One page's mutation queue runner record, over the browser's own Web Locks
 * and storage. The test drives it through `window.queueOwners`.
 */
export function QueueLeaseFixture() {
  const owner = new URLSearchParams(location.search).get('owner') ?? 'owner';
  Object.assign(window, { queueOwners: createQueueOwners(owner) });
  return <main class="p-4 text-ink">Queue runner {owner}</main>;
}
