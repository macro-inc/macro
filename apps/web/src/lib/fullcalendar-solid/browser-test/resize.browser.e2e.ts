import { expect, type Page, test } from '@playwright/test';

async function calls(page: Page) {
  await page.evaluate(() =>
    document.dispatchEvent(new Event('calendar-calls'))
  );
  return JSON.parse(await page.locator('[data-calls]').innerText()) as {
    method: string;
    hidden: boolean;
  }[];
}

async function settle(page: Page) {
  // Drain observer delivery and both the resize and custom-rendering frames.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      })
  );
}

test('container resizing pauses while hidden and replays current options on reveal', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.fc-event')).toHaveText('Planning');
  await settle(page);
  await page.getByRole('button', { name: 'Clear calls' }).click();
  await page.getByRole('button', { name: 'Toggle hidden' }).click();
  await settle(page);
  await page.getByRole('button', { name: 'Resize height' }).click();
  await page.getByRole('button', { name: 'Toggle weekends' }).click();
  await settle(page);
  expect(await calls(page)).toEqual([]);

  await page.getByRole('button', { name: 'Toggle hidden' }).click();
  await settle(page);
  expect(await calls(page)).toContainEqual({
    method: 'resetOptions',
    hidden: false,
  });
  expect(await calls(page)).toContainEqual({
    method: 'updateSize',
    hidden: false,
  });
  await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
  expect(
    await page.locator('.fc-view-harness').evaluate((el) => el.clientHeight)
  ).toBeLessThanOrEqual(400);

  await page.getByRole('button', { name: 'Clear calls' }).click();
  await page.getByRole('button', { name: 'Resize height' }).click();
  await settle(page);
  expect(
    (await calls(page)).filter((call) => call.method === 'updateSize').length
  ).toBeGreaterThan(0);
  expect(
    await page.locator('.fc-view-harness').evaluate((el) => el.clientHeight)
  ).toBeGreaterThan(500);
  await page.getByRole('button', { name: 'Clear calls' }).click();
  await settle(page);
  expect(await calls(page)).toEqual([]);
});

test('unmount cancels scheduled calendar work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.fc-event')).toHaveText('Planning');
  await settle(page);
  await page.getByRole('button', { name: 'Clear calls' }).click();
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    buttons.find((el) => el.textContent === 'Resize height')?.click();
    buttons.find((el) => el.textContent === 'Toggle mounted')?.click();
  });
  await settle(page);
  expect(await calls(page)).toEqual([]);
  await expect(page.locator('.fc')).toHaveCount(0);
});
