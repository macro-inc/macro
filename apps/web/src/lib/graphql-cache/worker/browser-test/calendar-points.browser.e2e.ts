import { expect, test } from '@playwright/test';

test('point events survive the real worker cache without acquiring a duration', async ({
  page,
}) => {
  await page.goto('calendar-points.html');
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', {
    timeout: 60_000,
  });
  expect(JSON.parse((await result.textContent())!)).toEqual({
    pointVisible: true,
    exactTimePreserved: true,
    exclusiveEnd: true,
    emptyRange: true,
    durationReplacement: true,
  });
});
