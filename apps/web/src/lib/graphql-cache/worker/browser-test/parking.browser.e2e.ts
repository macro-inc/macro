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
