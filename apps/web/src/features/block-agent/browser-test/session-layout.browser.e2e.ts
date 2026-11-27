import { expect, test } from '@playwright/test';

test('no transcript text shows behind or below the session composer', async ({
  page,
}) => {
  await page.goto('/session-layout.html');
  await expect(page.getByText('Answer 11.')).toBeVisible({ timeout: 30_000 });

  // Mid-transcript, where text would pass behind the composer and the strip
  // under it.
  const transcript = page.locator('[data-channel-scroll]');
  await transcript.evaluate((element) => element.scrollBy({ top: -200 }));
  const scrollArea = await transcript.boundingBox();
  const composer = await page.getByTestId('composer').boundingBox();
  if (!scrollArea || !composer)
    throw new Error('Transcript or composer missing');
  await page.screenshot({ path: test.info().outputPath('session-layout.png') });

  // The transcript's scroll area ends where the composer begins, so nothing
  // it scrolls can sit behind the composer or in the strip under it.
  expect(scrollArea.y + scrollArea.height).toBeLessThanOrEqual(composer.y + 1);
});

test('the jump-to-latest button sits above the composer, not over it', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The touch button; desktop shows a transient pill');
  await page.goto('/session-layout.html');
  await expect(page.getByText('Answer 11.')).toBeVisible({ timeout: 30_000 });

  await page
    .locator('[data-channel-scroll]')
    .evaluate((element) => element.scrollTo({ top: 0 }));
  const jump = page.getByRole('button', { name: 'Jump to latest' });
  await expect(jump).toBeVisible();

  const jumpBox = await jump.boundingBox();
  const composer = await page.getByTestId('composer').boundingBox();
  if (!jumpBox || !composer) throw new Error('Button or composer missing');
  expect(jumpBox.y + jumpBox.height).toBeLessThanOrEqual(composer.y);
});
