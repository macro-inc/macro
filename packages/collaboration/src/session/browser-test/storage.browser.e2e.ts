import { expect, test } from '@playwright/test';
import type {} from './fixture';

const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const url = '/src/session/browser-test/index.html';
test('SC-1/4/8: durable completion survives a renderer crash and is adopted once', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const doc = crypto.randomUUID();
  await page.goto(url);
  await page.evaluate(
    async ({ doc, owner }) => {
      await window.storageFixture.open(doc, owner);
      await window.storageFixture.execute(doc, owner, 2);
    },
    { doc, owner }
  );
  const reopened = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const crashed = page.waitForEvent('crash');
  const request = cdp.send('Page.crash').catch(() => undefined);
  await crashed;
  await page.close();
  await request;
  await reopened.goto(url);
  await reopened.evaluate(
    async ({ doc, other }) => window.storageFixture.open(doc, other),
    { doc, other }
  );
  const loaded = await reopened.evaluate(
    async ({ doc, other }) => window.storageFixture.execute(doc, other, 0),
    { doc, other }
  );
  expect(loaded).toMatchObject({
    orphans: [{ owner, seqs: ['1'], bytes: [[1, 255]] }],
  });
  const adopted = await reopened.evaluate(
    async ({ doc, owner, other }) =>
      window.storageFixture.execute(doc, other, 5, { from: owner, seq: 10n }),
    { doc, owner, other }
  );
  expect(adopted).toMatchObject({ kind: 'adopted', adopted: 1 });
  expect(
    await reopened.evaluate(
      async ({ doc }) => window.storageFixture.rows(doc),
      { doc }
    )
  ).toEqual([
    {
      owner: other,
      seq: '10',
      delivered: false,
      quarantined: false,
      bytes: [1, 255],
    },
  ]);
  await context.close();
});
test('SC-2/6/9: lock grant gates FIFO writes and uncertain replay stays idempotent', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  const doc = crypto.randomUUID();
  await a.goto(url);
  await b.goto(url);
  await a.evaluate(
    async ({ doc, owner }) => window.storageFixture.open(doc, owner),
    { doc, owner }
  );
  await b.evaluate(
    ({ doc, owner }) => {
      window.storageFixture.open(doc, owner).catch(() => undefined);
    },
    { doc, owner }
  );
  expect(await a.evaluate(() => window.storageFixture.held())).toContain(
    `macro-wal:${doc}:${owner}`
  );
  await a.evaluate(async (owner) => window.storageFixture.close(owner), owner);
  await b.evaluate(
    async ({ doc, owner }) => {
      await window.storageFixture.execute(doc, owner, 2);
      await window.storageFixture.execute(doc, owner, 2, { retry: true });
      await window.storageFixture.execute(doc, owner, 3, { through: 1n });
    },
    { doc, owner }
  );
  expect(
    await b.evaluate(async (doc) => window.storageFixture.rows(doc), doc)
  ).toEqual([
    { owner, seq: '1', delivered: true, quarantined: false, bytes: [1, 255] },
  ]);
  await context.close();
});
test('SC-3/5/7: errors never wipe; snapshot deletion retains undelivered rows', async ({
  page,
}) => {
  const doc = crypto.randomUUID();
  await page.goto(url);
  await page.evaluate(
    async ({ doc, owner }) => {
      await window.storageFixture.open(doc, owner);
      await window.storageFixture.execute(doc, owner, 2);
      await window.storageFixture.execute(doc, owner, 8, {
        snapshot: new Uint8Array([9]),
        coversOwner: owner,
        coversSeq: 1n,
      });
      await window.storageFixture.execute(doc, owner, 9);
      await window.storageFixture.execute(doc, owner, 4, { through: 1n });
    },
    { doc, owner }
  );
  expect(
    await page.evaluate(async (doc) => window.storageFixture.rows(doc), doc)
  ).toHaveLength(1);
  const refused = await page.evaluate(
    async ({ doc, owner }) => window.storageFixture.execute(doc, owner, 99),
    { doc, owner }
  );
  expect(refused).toMatchObject({ kind: 'done', ok: false });
  expect(
    await page.evaluate(async (doc) => window.storageFixture.rows(doc), doc)
  ).toHaveLength(1);
});
test('live owners supply assist rows; closing a tab frees its lock and preserves legacy rows', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  const doc = crypto.randomUUID();
  await a.goto(url);
  await b.goto(url);
  await a.evaluate(
    async ({ doc, owner }) => {
      await window.storageFixture.open(doc, owner);
      await window.storageFixture.execute(doc, owner, 2);
      await window.storageFixture.legacy(doc);
    },
    { doc, owner }
  );
  await b.evaluate(
    async ({ doc, other }) => window.storageFixture.open(doc, other),
    { doc, other }
  );
  expect(
    await b.evaluate(
      async ({ doc, other }) => window.storageFixture.execute(doc, other, 0),
      { doc, other }
    )
  ).toMatchObject({ assist: [owner], orphans: [{ owner: '' }] });
  await a.close({ runBeforeUnload: false });
  await b.evaluate(
    async ({ doc, owner }) => window.storageFixture.waitReleased(doc, owner),
    { doc, owner }
  );
  expect(
    await b.evaluate(
      async ({ doc, other }) => window.storageFixture.execute(doc, other, 1),
      { doc, other }
    )
  ).toMatchObject({
    assist: [],
    orphans: expect.arrayContaining([
      { owner, seqs: ['1'], bytes: [[1, 255]] },
    ]),
  });
  await context.close();
});

test('SC-3: a proven rollback retries once without duplicate rows in real IndexedDB', async ({
  page,
}) => {
  const doc = crypto.randomUUID();
  await page.goto(url);
  const result = await page.evaluate(
    async ({ doc, owner }) => {
      await window.storageFixture.open(doc, owner);
      window.storageFixture.injectAppendFailure('AbortError');
      return window.storageFixture.execute(doc, owner, 2);
    },
    { doc, owner }
  );
  expect(result).toMatchObject({ kind: 'done', ok: true });
  expect(
    await page.evaluate(async (doc) => window.storageFixture.rows(doc), doc)
  ).toHaveLength(1);
});
test('SC-5: quota failure returns an error and preserves durable rows in real IndexedDB', async ({
  page,
}) => {
  const doc = crypto.randomUUID();
  await page.goto(url);
  const result = await page.evaluate(
    async ({ doc, owner }) => {
      await window.storageFixture.open(doc, owner);
      await window.storageFixture.execute(doc, owner, 2);
      window.storageFixture.injectAppendFailure('QuotaExceededError');
      return window.storageFixture.execute(doc, owner, 2, {
        record: {
          seq: 2n,
          createdAt: 2n,
          user: 'fixture-user',
          foreign: false,
          quarantined: false,
          delivered: false,
          bytes: new Uint8Array([2]),
        },
      });
    },
    { doc, owner }
  );
  expect(result).toMatchObject({ kind: 'done', ok: false, failure: 2 });
  expect(
    await page.evaluate(async (doc) => window.storageFixture.rows(doc), doc)
  ).toHaveLength(1);
});
