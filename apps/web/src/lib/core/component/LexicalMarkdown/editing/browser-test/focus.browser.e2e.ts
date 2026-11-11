import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test('actual exterior target preserves a focused range and appends only after leaving it', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.getByText('Retained check', { exact: true }).click();
  await expect(body).toBeFocused();
  await page.getByTestId('exterior').click();
  await expect(body.locator(':scope > p')).toHaveCount(0);
  await expect(body).toBeFocused();

  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await page.getByTestId('exterior').click();
  await expect(body.locator(':scope > p')).toHaveCount(1);
  await expect(body).toBeFocused();
  await page.keyboard.type('After checklist');
  await expect(body.locator(':scope > p')).toHaveText('After checklist');
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await page.getByTestId('exterior').click();
  await expect(body.locator(':scope > p')).toHaveCount(2);
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await page.getByTestId('exterior').click();
  await expect(body.locator(':scope > p')).toHaveCount(2);
  await expect(body).toBeFocused();
});

test('queued focus runs only after the real native action and Diff complete', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Queue focus', exact: true }).click();
  await expect(page.locator('#queued')).toHaveText(
    JSON.stringify({
      duringCalls: 0,
      afterCalls: 1,
      duringParagraphs: 0,
      afterParagraphs: 1,
    })
  );
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('Queued caret');
  await expect(page.getByRole('textbox').locator(':scope > p')).toHaveText(
    'Queued caret'
  );
});

for (const effect of ['dispose', 'readonly']) {
  test(`queued focus rechecks ${effect} before browser focus`, async ({
    page,
  }) => {
    const name =
      effect === 'dispose'
        ? 'Queue focus then dispose'
        : 'Queue focus then readonly';
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#queued')).toHaveText(
      JSON.stringify({
        duringCalls: 0,
        afterCalls: 0,
        duringParagraphs: 0,
        afterParagraphs: 1,
      })
    );
  });
}
