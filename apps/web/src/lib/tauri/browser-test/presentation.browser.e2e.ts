import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/presentation.html');
  await expect(
    page.getByRole('button', { name: 'Open notification', exact: true })
  ).toBeVisible();
});

test('a warm notification reveals its destination without presenting the previous pane', async ({
  page,
}) => {
  await page.clock.fastForward(20_000);
  await page
    .getByRole('button', { name: 'Open notification', exact: true })
    .click();
  await expect(page.locator('#cover')).toHaveCount(0);
  expect(
    await page.evaluate(() => window.notificationPresentationFixture.snapshot())
  ).toMatchObject({
    covered: false,
    acknowledgments: ['destination'],
    presented: 'destination',
    pending: undefined,
  });
});

test('waits for a delayed destination shell instead of consuming the tap after a frame', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.notificationPresentationFixture.delayShell()
  );
  await page
    .getByRole('button', { name: 'Open notification', exact: true })
    .click();
  await page.clock.runFor(200);
  expect(
    await page.evaluate(() => window.notificationPresentationFixture.snapshot())
  ).toMatchObject({
    covered: true,
    acknowledgments: [],
    presented: 'destination',
  });
  await page.evaluate(() =>
    window.notificationPresentationFixture.mountShell()
  );
  await expect(page.locator('#cover')).toHaveCount(0);
  expect(
    await page.evaluate(() => window.notificationPresentationFixture.snapshot())
  ).toMatchObject({
    covered: false,
    acknowledgments: ['destination'],
    pending: undefined,
  });
});

test('ordinary navigation retains the mobile forward transition', async ({
  page,
}) => {
  const initial = await page.evaluate(() => {
    window.notificationPresentationFixture.openOrdinary();
    return window.notificationPresentationFixture.snapshot();
  });
  expect(initial).toMatchObject({
    presented: 'previous',
    acknowledgments: [],
    destinationTransform: 'translateX(100%)',
  });
  await expect(page.locator('#viewport')).toHaveAttribute(
    'data-presented',
    'destination'
  );
});
