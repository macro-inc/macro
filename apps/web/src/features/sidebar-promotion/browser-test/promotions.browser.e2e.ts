import { expect, test } from '@playwright/test';

const fixture = '/src/features/sidebar-promotion/browser-test/promotions.html';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
});

test('runs either Home action and dismisses a card', async ({ page }) => {
  const home = page.getByRole('complementary', { name: 'Home sidebar' });
  const result = page.getByRole('status', { name: 'Last action' });
  await home
    .getByRole('button', { name: 'Connect tools', exact: true })
    .click();
  await expect(result).toHaveText('Connect tools');
  await home.getByRole('button', { name: 'Invite team' }).click();
  await expect(result).toHaveText('Invite team');
  await home.getByRole('button', { name: 'Dismiss connect tools' }).click();
  await expect(
    home.getByRole('button', { name: 'Connect tools', exact: true })
  ).toHaveCount(0);
});

test('keeps every pitch to two lines at the default sidebar width', async ({
  page,
}) => {
  const lines = await page
    .locator('[role=region] p')
    .evaluateAll((pitches) =>
      pitches.map((pitch) =>
        Math.round(
          pitch.getBoundingClientRect().height /
            Number.parseFloat(getComputedStyle(pitch).lineHeight)
        )
      )
    );
  expect(lines).toEqual([2, 2, 2]);
});
