import { expect, test } from '@playwright/test';

const path = (project: string) =>
  project.includes('production') ? '/app/parking.html' : '/parking.html';

test('all-hidden storage parks and another page reopens it without waking the old owner', async ({
  context,
  page,
}, info) => {
  const url = `${path(info.project.name)}?scope=cache-parking-${crypto.randomUUID()}`;
  await page.goto(url);
  await page.evaluate(() => window.cacheParkingHarness.start(true));
  const before = await page.evaluate(() =>
    window.cacheParkingHarness.snapshot()
  );
  const other = await context.newPage();
  await other.goto(url);
  await other.bringToFront();
  // Headless browsers keep every page visible. Exercise the visibility event
  // deterministically here; real Safari lifecycle qualification is separate.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');
  await page.evaluate(() => window.cacheParkingHarness.parked());
  const locks = await other.evaluate(() => window.cacheParkingHarness.locks());
  expect(
    locks?.filter((lock) => lock.name?.startsWith('macro:turso-opfs:'))
  ).toEqual([]);
  await other.evaluate(() => window.cacheParkingHarness.start());
  const after = await other.evaluate(() =>
    window.cacheParkingHarness.snapshot()
  );
  expect(after.generation).toBe(before.generation);
  expect(after.queue?.map((item) => item.uuid)).toEqual([before.seedUuid]);
  expect(after.read).toMatchObject({ kind: 'hit' });
  const old = await page.evaluate(() => window.cacheParkingHarness.snapshot());
  expect(old.clientId).toBe(before.clientId);
  expect(old.generation).toBe(before.generation);
  expect(old.visibility).toBe('hidden');
});

test('delivers a query admitted while parked across replacement without API fallback', async ({
  context,
  page,
}, info) => {
  const url = `${path(info.project.name)}?scope=cache-parking-${crypto.randomUUID()}`;
  await page.goto(url);
  await page.evaluate(() => window.cacheParkingHarness.start(true));
  const before = await page.evaluate(() =>
    window.cacheParkingHarness.snapshot()
  );
  const other = await context.newPage();
  await other.goto(url);
  await other.bringToFront();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => window.cacheParkingHarness.parked());
  await page.evaluate(() => window.cacheParkingHarness.beginRead());
  await other.evaluate(() => window.cacheParkingHarness.start());
  expect(
    await page.evaluate(() => window.cacheParkingHarness.readResult())
  ).toEqual({
    data: { user: { id: 'macro|parking-fixture' } },
    error: false,
  });
  const after = await page.evaluate(() =>
    window.cacheParkingHarness.snapshot()
  );
  expect(after.readApiRequests).toBe(0);
  expect(after.clientId).toBe(before.clientId);
  expect(after.generation).toBe(before.generation);
  expect(after.queue?.map((item) => item.uuid)).toEqual([before.seedUuid]);
});

test('coalesces parked catch-up commits into one visible-cache refresh', async ({
  page,
}, info) => {
  await page.clock.install();
  await page.goto(
    `${path(info.project.name)}?scope=cache-parking-${crypto.randomUUID()}`
  );
  await page.evaluate(() => window.cacheParkingHarness.start());
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => window.cacheParkingHarness.parked());
  await page.evaluate(() => window.cacheParkingHarness.queueCatchup());
  expect(
    await page.evaluate(() => window.cacheParkingHarness.catchupSnapshot())
  ).toMatchObject({ revisions: [], refreshes: 0 });

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => window.cacheParkingHarness.catchupDone());
  // Any dirty trailing refresh would run here; no wall-clock sleep is needed.
  await page.clock.runFor(1_000);
  const caughtUp = await page.evaluate(() =>
    window.cacheParkingHarness.catchupSnapshot()
  );
  expect(caughtUp.revisions).toHaveLength(1);
  expect(caughtUp.batches).toEqual([5]);
  expect(caughtUp.refreshes).toBe(1);
  expect(caughtUp.read).toMatchObject({
    kind: 'hit',
    data: { user: { id: 'catchup-3' } },
  });
  await page.evaluate(() => window.cacheParkingHarness.dispose());
});

test('delivers a background notification before cache persistence without replaying it on resume', async ({
  page,
}, info) => {
  await page.goto(
    `${path(info.project.name)}?scope=cache-parking-${crypto.randomUUID()}`
  );
  await page.evaluate(() => window.cacheParkingHarness.start());
  await page.evaluate(() => window.cacheParkingHarness.startNotifications());
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => window.cacheParkingHarness.parked());
  await page.evaluate(() => window.cacheParkingHarness.emitNotification());
  expect(
    await page.evaluate(() => window.cacheParkingHarness.notifications())
  ).toEqual({ received: ['synthetic-notification'], persisted: [] });

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => window.cacheParkingHarness.notificationPersisted());
  expect(
    await page.evaluate(() => window.cacheParkingHarness.notifications())
  ).toEqual({
    received: ['synthetic-notification'],
    persisted: ['synthetic-notification'],
  });
  await page.evaluate(() => window.cacheParkingHarness.dispose());
});

test('settles a response received while parked before a competing expired-lease claim', async ({
  context,
  page,
}, info) => {
  const url = `${path(info.project.name)}?scope=cache-parking-${crypto.randomUUID()}`;
  await page.goto(url);
  await page.evaluate(() => window.cacheParkingHarness.start());
  const uuid = await page.evaluate(() =>
    window.cacheParkingHarness.beginMutation()
  );
  const before = await page.evaluate(() =>
    window.cacheParkingHarness.snapshot()
  );
  const other = await context.newPage();
  await other.goto(url);
  await other.bringToFront();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => window.cacheParkingHarness.parked());
  await page.evaluate((uuid) => window.cacheParkingHarness.reply(uuid), uuid);
  expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');
  const locks = await other.evaluate(() => window.cacheParkingHarness.locks());
  expect(
    locks?.filter((lock) => lock.name?.startsWith('macro:turso-opfs:'))
  ).toEqual([]);
  await other.evaluate(() => window.cacheParkingHarness.start());
  expect(
    await other.evaluate(() => window.cacheParkingHarness.competingClaim())
  ).toBeFalsy();
  const after = await other.evaluate(() =>
    window.cacheParkingHarness.snapshot()
  );
  expect(after.generation).toBe(before.generation);
  expect(after.queue).toEqual([]);
  const result = await page.evaluate(() => window.cacheParkingHarness.result());
  expect(result).toMatchObject({
    data: { setEntityProperty: { id: uuid, displayName: 'Confirmed' } },
  });
  expect(
    (await page.evaluate(() => window.cacheParkingHarness.snapshot()))
      .apiRequests
  ).toBe(1);
});
