import { expect, test } from '@playwright/test';

test('a toast never covers the session composer’s Send button', async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.goto('/composer.html?toast');

  const toast = page.getByText("Couldn't send your answer");
  await expect(toast).toBeVisible();

  await page.getByRole('textbox').first().click();
  await page.keyboard.type('Retry the answer');
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeEnabled();

  // Wait for the toast's entrance to settle before measuring where it sits.
  await expect(toast).toHaveCSS('opacity', '1');
  const sendBox = await send.boundingBox();
  const toastBox = await page
    .locator('[data-toast-id], .macro-toast')
    .first()
    .boundingBox();
  if (!sendBox || !toastBox) throw new Error('Send or toast not laid out');
  await page.screenshot({
    path: test.info().outputPath('toast-over-composer.png'),
  });

  const overlaps =
    toastBox.x < sendBox.x + sendBox.width &&
    toastBox.x + toastBox.width > sendBox.x &&
    toastBox.y < sendBox.y + sendBox.height &&
    toastBox.y + toastBox.height > sendBox.y;
  expect(overlaps).toBe(false);

  // A pointer at Send's centre reaches Send, not the toast above it.
  await page.mouse.click(
    sendBox.x + sendBox.width / 2,
    sendBox.y + sendBox.height / 2
  );
  await expect(page.locator('body')).toHaveAttribute('data-sent', '1');
});
