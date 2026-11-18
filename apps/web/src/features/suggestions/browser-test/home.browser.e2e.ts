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

for (const theme of ['dark', 'light']) {
  test(`evening chips start at their own times, near now and the strip's end, in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?view=home&day=evening&theme=${theme}`);

    const today = page.getByRole('region', { name: 'Today' });
    await expect(today.getByRole('button')).toHaveCount(6);
    await today.screenshot({
      path: testInfo.outputPath(`today-evening-${theme}.png`),
    });
    // Each hour mark's line is the left edge of its label's parent.
    const hourX = async (label: string) =>
      (
        await today
          .getByText(label, { exact: true })
          .locator('..')
          .boundingBox()
      )?.x ?? Number.NaN;
    const four = await hourX('4pm');
    const six = await hourX('6pm');
    const hour = (six - four) / 2;
    const chipX = async (title: string) =>
      (await today.getByRole('button', { name: `Open ${title}` }).boundingBox())
        ?.x ?? Number.NaN;

    // 18:00, a quarter hour before now: on the 6pm line, not ending at it.
    expect(Math.abs((await chipX('Prod deploy')) - six)).toBeLessThan(1.5);
    // 19:30, too close to the end for a full-width chip: still at 19:30.
    expect(
      Math.abs((await chipX('Release check')) - (six + 1.5 * hour))
    ).toBeLessThan(1.5);
    // 13:30: two and a half hours before 4pm.
    expect(Math.abs((await chipX('1:1')) - (four - 2.5 * hour))).toBeLessThan(
      1.5
    );

    const strip = await today.boundingBox();
    for (const chip of await today.getByRole('button').all()) {
      const box = await chip.boundingBox();
      expect(
        box && strip && box.x + box.width <= strip.x + strip.width + 0.5
      ).toBe(true);
    }

    // The late chip is too narrow for its title: hovering names it and its time.
    await today.getByRole('button', { name: 'Open Release check' }).hover();
    await expect(page.getByRole('tooltip')).toContainText(
      /Release check, 7:30\s*–\s*8:00\s*PM/
    );
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
