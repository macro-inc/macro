import { expect, test } from '@playwright/test';

test('opens a separate transcript, preserves reading navigation, and hides the panel in narrow panes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/src/features/block-call/browser-test/view.html');
  const toggle = page.getByRole('button', { name: 'Transcript', exact: true });
  const summary = page.getByRole('radio', { name: 'Summary', exact: true });
  const transcript = page.getByRole('radio', {
    name: 'Transcript',
    exact: true,
  });
  await expect(toggle).toBeVisible();
  await expect(summary).toBeChecked();
  await page
    .locator('label')
    .filter({ hasText: /^Transcript$/ })
    .click();
  await expect(transcript).toBeChecked();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(summary).toBeChecked();
  const panel = page.getByRole('complementary', { name: 'Transcript' });
  await expect(panel).toBeVisible();
  await expect(page.getByText('Playback has one transcript line.')).toHaveCount(
    1
  );
  await panel
    .getByRole('button', { name: /Playback has one transcript line/ })
    .click();
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((element: HTMLVideoElement) => element.currentTime)
    )
    .toBeCloseTo(1);
  await page
    .locator('label')
    .filter({ hasText: /^Transcript$/ })
    .click();
  await expect(transcript).toBeChecked();
  await expect(page.getByText('Playback has one transcript line.')).toHaveCount(
    2
  );
  await page
    .locator('label')
    .filter({ hasText: /^Summary$/ })
    .click();
  if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d46-transcript-wide.png`,
    });
  await toggle.click();
  await expect(panel).toHaveCount(0);
  await expect(summary).toBeChecked();
  await toggle.click();
  await page.setViewportSize({ width: 680, height: 900 });
  await expect(toggle).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await page
    .locator('label')
    .filter({ hasText: /^Transcript$/ })
    .click();
  await expect(page.getByText('Playback has one transcript line.')).toHaveCount(
    1
  );
  if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d46-transcript-narrow.png`,
    });
});

for (const width of [390, 1280]) {
  test(`touch panes use the reading tabs without a transcript header action (${width}px)`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto('/src/features/block-call/browser-test/view.html');
      await expect(
        page.getByRole('button', { name: 'Transcript', exact: true })
      ).toHaveCount(0);
      await page
        .locator('label')
        .filter({ hasText: /^Transcript$/ })
        .click();
      await expect(
        page.getByRole('radio', { name: 'Transcript', exact: true })
      ).toBeChecked();
      await expect(
        page.getByText('Playback has one transcript line.')
      ).toHaveCount(1);
    } finally {
      await context.close();
    }
  });
}
