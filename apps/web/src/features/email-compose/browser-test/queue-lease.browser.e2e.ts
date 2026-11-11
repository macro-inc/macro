import type { QueueOwners } from '@graphql-cache/exchange/queue-owners';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';

const lease = { transactionId: '7', leaseGeneration: '2', itemId: 'item' };
type Lease = typeof lease;
const runnerOf = () =>
  (window as unknown as { queueOwners: QueueOwners }).queueOwners;

/** A page running one queue runner, with the real Web Locks and storage. */
async function open(context: BrowserContext, owner: string) {
  const page = await context.newPage();
  await page.goto(`/?queue-lease&owner=${owner}`);
  // A tab in the background is not painted, so wait for the runner itself.
  await page.waitForFunction(() => 'queueOwners' in window);
  return page;
}

const record = async (page: Page, held?: Lease) =>
  await page.evaluate(
    ([run, held]) => {
      // Passed as source so the page resolves its own `window`.
      const runner = new Function(`return (${run})()`)() as QueueOwners;
      runner.record('storage', held ?? undefined);
    },
    [runnerOf.toString(), held ?? null] as const
  );

const abandoned = async (page: Page, settledAfterMs: number) =>
  await page.evaluate(
    async ([run, settledAfterMs]) => {
      const runner = new Function(`return (${run})()`)() as QueueOwners;
      return await runner.abandoned('storage', settledAfterMs);
    },
    [runnerOf.toString(), settledAfterMs] as const
  );

const recorded = async (page: Page, owner: string) =>
  await page.evaluate(
    (key) => localStorage.getItem(key),
    `graphql-cache:queue-owner:${owner}`
  );

test('a lease is handed over only after its page is gone', async ({
  context,
}) => {
  const first = await open(context, 'first');
  const second = await open(context, 'second');
  await record(first, lease);
  await expect.poll(() => recorded(second, 'first')).not.toBeNull();

  // Alive, in another tab: its lease is its own business.
  expect((await abandoned(second, 0)).leases).toEqual([]);
  expect(await recorded(second, 'first')).not.toBeNull();

  await first.close();
  // The browser releases a closed page's locks a moment after it is gone.
  await expect
    .poll(async () => (await abandoned(second, 0)).leases)
    .toEqual([{ owner: 'first', ...lease }]);
  // Handed over once, and the runner is forgotten.
  expect((await abandoned(second, 0)).leases).toEqual([]);
  expect(await recorded(second, 'first')).toBeNull();
});

test('a reload leaves the old page lease to the new page, once its request has timed out', async ({
  context,
}) => {
  const page = await open(context, 'before-reload');
  await record(page, lease);
  await expect.poll(() => recorded(page, 'before-reload')).not.toBeNull();

  // Every page load is a new runner.
  await page.goto('/?queue-lease&owner=after-reload');
  await page.waitForFunction(() => 'queueOwners' in window);

  const early = await abandoned(page, 60_000);
  expect(early.leases).toEqual([]);
  expect(early.pendingUntil).toBeGreaterThan(Date.now());
  expect((await abandoned(page, 0)).leases).toEqual([
    { owner: 'before-reload', ...lease },
  ]);
});
