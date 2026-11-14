import { expect, test } from '@playwright/test';

for (const theme of ['dark', 'light']) {
  test(`Home shows today's strip and the top priorities in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?view=home&theme=${theme}`);

    const today = page.getByRole('region', { name: 'Today' });
    await expect(today.getByRole('button')).toHaveCount(4);
    // Every chip and hour label stays inside the strip.
    const strip = await today.boundingBox();
    for (const chip of await today.getByRole('button').all()) {
      const box = await chip.boundingBox();
      expect(box && strip && box.x >= strip.x).toBe(true);
      expect(box && strip && box.x + box.width <= strip.x + strip.width).toBe(
        true
      );
    }

    // The most important first, as the server ranked them; done ones are left out.
    await expect(page.locator('[data-priority]')).toHaveCount(5);
    await expect(page.locator('[data-priority]').first()).toHaveAttribute(
      'data-priority',
      'suggestion-drafted-reply'
    );
    await expect(page.locator('[data-priority="suggestion-done"]')).toHaveCount(
      0
    );
    await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`) });
  });
}

test('a priority opens For you on that suggestion, and events open the calendar', async ({
  page,
}) => {
  await page.goto('/?view=home');

  await page.locator('[data-priority="suggestion-drafted-reply"]').click();
  await expect(page.getByLabel('Opened')).toHaveText(
    'suggestion suggestion-drafted-reply'
  );

  await page.getByRole('button', { name: 'All in For you' }).click();
  await expect(page.getByLabel('Opened')).toHaveText('all');

  await page.getByRole('button', { name: 'Open Design review' }).click();
  await expect(page.getByLabel('Opened')).toHaveText('event review');
});

test('without a calendar, only the priorities show', async ({ page }) => {
  await page.goto('/?view=home&calendar=none');

  await expect(page.getByRole('region', { name: 'Today' })).toHaveCount(0);
  await expect(page.locator('[data-priority]')).toHaveCount(5);
});
