import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Open another page' })
  ).toBeVisible();
});

test('releases a warm tap while acknowledgment waits for a frame, retaining it for completion', async ({
  page,
}) => {
  // The initial mount deadline would already have expired on a warm resume.
  await page.clock.fastForward(20_000);
  await page.evaluate(() => {
    window.notificationCoverFixture.blockFrames();
    window.notificationCoverFixture.tap('first');
    window.notificationCoverFixture.complete();
  });
  expect(
    await page.evaluate(() => window.notificationCoverFixture.snapshot())
  ).toEqual({
    commands: ['plugin:notifications|release_notification_cover'],
    nativePending: 'first',
    pending: 'first',
    blockedFrames: 1,
    covered: true,
  });
  await page.clock.fastForward(8000);
  expect(
    await page.evaluate(() => window.notificationCoverFixture.snapshot())
  ).toEqual({
    commands: [
      'plugin:notifications|release_notification_cover',
      'plugin:notifications|release_notification_cover',
    ],
    nativePending: 'first',
    pending: 'first',
    blockedFrames: 1,
    covered: false,
  });
  await page.getByRole('button', { name: 'Open another page' }).click();
  await expect(page.locator('#navigation')).toHaveText('Another page');

  await page.evaluate(() => window.notificationCoverFixture.flushFrames());
  expect(
    await page.evaluate(() => window.notificationCoverFixture.snapshot())
  ).toEqual({
    commands: [
      'plugin:notifications|release_notification_cover',
      'plugin:notifications|release_notification_cover',
      'plugin:notifications|acknowledge_notification',
    ],
    nativePending: undefined,
    pending: undefined,
    blockedFrames: 0,
    covered: false,
  });
});

test('the startup cap does not release a later notification cover', async ({
  page,
}) => {
  await page.clock.fastForward(7000);
  await page.evaluate(() => window.notificationCoverFixture.tap('startup-tap'));
  await page.clock.fastForward(1000);
  expect(
    await page.evaluate(() => window.notificationCoverFixture.snapshot())
  ).toMatchObject({ commands: [], pending: 'startup-tap', covered: true });
  await page.clock.fastForward(7000);
  expect(
    await page.evaluate(() => window.notificationCoverFixture.snapshot())
  ).toMatchObject({
    commands: ['plugin:notifications|release_notification_cover'],
    pending: 'startup-tap',
    covered: false,
  });
});

test('a newer tap replaces the old deadline and duplicate delivery does not extend it', async ({
  page,
}) => {
  await page.evaluate(() => window.notificationCoverFixture.tap('first'));
  await page.clock.fastForward(4000);
  await page.evaluate(() => window.notificationCoverFixture.tap('second'));
  await page.clock.fastForward(4000);
  await page.evaluate(() => window.notificationCoverFixture.tap('second'));
  expect(
    await page.evaluate(() => window.notificationCoverFixture.snapshot())
  ).toMatchObject({
    commands: [],
    pending: 'second',
    covered: true,
  });
  await page.clock.fastForward(4000);
  expect(
    await page.evaluate(() => window.notificationCoverFixture.snapshot())
  ).toMatchObject({
    commands: ['plugin:notifications|release_notification_cover'],
    nativePending: 'second',
    pending: 'second',
    covered: false,
  });
});
