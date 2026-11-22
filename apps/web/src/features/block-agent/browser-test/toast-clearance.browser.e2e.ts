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

test('a hidden composer, as in a parked tab, leaves the toast at its usual spot', async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.goto('/composer.html?toast&hidden');

  const toast = page.locator('.macro-toast').first();
  await expect(toast).toHaveCSS('opacity', '1');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No viewport');

  // Unlifted, the toast sits within about 20px of the window's bottom edge.
  await expect
    .poll(async () => (await toast.boundingBox())?.y ?? 0)
    .toBeGreaterThan(viewport.height - 120);
});

test('the toast drops back when the composer it cleared closes', async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.goto('/composer.html?toast');

  const toast = page.locator('.macro-toast').first();
  await expect(toast).toHaveCSS('opacity', '1');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No viewport');
  const composerTop =
    (await page.getByRole('textbox').first().boundingBox())?.y ?? 0;
  const lifted = await toast.boundingBox();
  if (!lifted) throw new Error('Toast not laid out');
  expect(lifted.y + lifted.height).toBeLessThan(composerTop);

  await page.getByRole('button', { name: 'Close composer' }).click();
  await expect
    .poll(async () => (await toast.boundingBox())?.y ?? 0)
    .toBeGreaterThan(viewport.height - 120);
});

test('a prompt stays clear of the composer after the toast under it expires', async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.goto('/composer.html?prompt&toast=1500');

  const prompt = page
    .locator('.macro-toast')
    .filter({ hasText: 'Reconnect your calendar' });
  await expect(prompt).toBeVisible();
  await expect(page.getByText("Couldn't send your answer")).toHaveCount(0);

  const composer = page.locator('[data-keep-keyboard]').first();
  await expect
    .poll(async () => {
      const promptBox = await prompt.boundingBox();
      const composerBox = await composer.boundingBox();
      if (!promptBox || !composerBox) return Number.NaN;
      return composerBox.y - (promptBox.y + promptBox.height);
    })
    .toBeGreaterThanOrEqual(0);
});
