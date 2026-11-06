import { expect, test } from '@playwright/test';

for (const width of [390, 320]) {
  for (const theme of ['light', 'dark']) {
    test(`keeps sheet amounts aligned at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/?billing&sheet${theme === 'dark' ? '&dark' : ''}`);
      const amounts = page.getByText(/^(?:\$\d[\d,.]*|Included for Macro)$/);
      await expect(amounts).toHaveCount(9);
      const geometry = await amounts.evaluateAll((elements) =>
        elements.map((element) => ({
          right: element.getBoundingClientRect().right,
          figures: getComputedStyle(element).fontVariantNumeric,
        }))
      );
      for (const amount of geometry) {
        expect(Math.abs(amount.right - geometry[0].right)).toBeLessThanOrEqual(
          0.5
        );
        expect(amount.figures).toContain('tabular-nums');
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        )
      ).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(`billing-${width}-${theme}.png`),
        fullPage: true,
      });
    });
  }
}

test('live unhealthy agent health overrides ready computer status without changing billing', async ({
  page,
}) => {
  await page.goto('/?billing&unhealthy');
  const status = page.getByText('Unhealthy', { exact: true });
  await expect(status).toBeVisible();
  await expect(status).toHaveClass(/text-failure/);
  await expect(page.getByText('$190.00', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Restore agent health', exact: true })
    .click();
  await expect(status).toHaveCount(0);
  await expect(page.getByText('Running', { exact: true })).toHaveCount(2);
  await expect(page.getByText('$190.00', { exact: true })).toBeVisible();
});

test('shows actual subscription lines and a distinct upcoming invoice without overflow', async ({
  page,
}) => {
  await page.goto('/?billing');
  await expect(
    page.getByText('Subscription breakdown', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Human seats', { exact: true })).toBeVisible();
  await expect(page.getByText('Agent seats', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Assistant · Standard', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Research agent · Large', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Included agent · XL', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Included for Macro', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Extra storage', { exact: true })).toBeVisible();
  await expect(page.getByText('$190.00', { exact: true })).toBeVisible();
  await expect(page.getByText('$223.45', { exact: true })).toBeVisible();
  await expect(page.getByText('Tax', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  ).toBe(false);
});

for (const [currency, total, computerPrice] of [
  ['jpy', '¥19,000', '¥3,000'],
  ['kwd', 'KWD 19.000', 'KWD 3.000'],
  ['isk', 'ISK 190', 'ISK 30'],
  ['ugx', 'UGX 190', 'UGX 30'],
] as const) {
  test(`scales ${currency} provider minor units`, async ({ page }) => {
    await page.goto(`/?billing&currency=${currency}`);
    await expect(page.getByText(total, { exact: true })).toBeVisible();
    await expect(page.getByText(computerPrice, { exact: true })).toHaveCount(3);
  });
}

test('uses server currency and interval and does not invent billing without a subscription', async ({
  page,
}) => {
  await page.goto('/?billing&annual&eur');
  await expect(page.getByText('Total per year', { exact: true })).toBeVisible();
  await expect(page.getByText('€190.00', { exact: true })).toBeVisible();
  await page.goto('/?billing&no-plan');
  await expect(
    page.getByText('Subscription breakdown', { exact: true })
  ).toHaveCount(0);
  await expect(page.getByText('Total per month', { exact: true })).toHaveCount(
    0
  );
});
