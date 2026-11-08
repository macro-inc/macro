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

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 960]) {
    test(`floating cards reserve content space and replace each other (${theme}, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/src/features/block-call/browser-test/view.html?theme=${theme}`
      );
      const transcript = page.getByRole('complementary', {
        name: 'Transcript',
      });
      const details = page.getByRole('complementary', {
        name: 'Block details',
      });
      const toggle = page.getByRole('button', {
        name: 'Transcript',
        exact: true,
      });
      await page
        .getByRole('button', { name: 'Show details', exact: true })
        .click();
      await expect(details).toBeVisible();
      await expect(details).toHaveCSS('opacity', '1');
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d47-${theme}-${width}-details.png`,
        });
      await toggle.click();
      await expect(details).toHaveCount(0);
      await expect(transcript).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const geometry = await transcript.evaluate((element: HTMLElement) => {
        const card = element.getBoundingClientRect();
        const parent = element.offsetParent!;
        const pane = parent.getBoundingClientRect();
        const content = parent
          .querySelector('[data-channel-scroll]')!
          .getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: card.width,
          top: card.top - pane.top,
          right: pane.right - card.right,
          bottom: pane.bottom - card.bottom,
          contentGap: card.left - content.right,
          radius: style.borderRadius,
          background: style.backgroundColor,
          pageBackground: getComputedStyle(document.body).backgroundColor,
          shadow: style.boxShadow,
          padding: style.padding,
        };
      });
      expect(geometry.width).toBe(360);
      expect(geometry.top).toBe(12);
      expect(geometry.right).toBe(12);
      expect(geometry.bottom).toBe(12);
      expect(geometry.contentGap).toBe(12);
      expect(geometry.radius).not.toBe('0px');
      expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(geometry.background).not.toBe(geometry.pageBackground);
      expect(geometry.shadow).not.toBe('none');
      expect(geometry.padding).not.toBe('0px');
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d47-${theme}-${width}-transcript.png`,
        });

      // Seek first so the fixture has an active row, then scroll away from it.
      const activeRow = transcript.getByRole('button', {
        name: /Playback has one transcript line/,
      });
      await activeRow.click();
      await expect
        .poll(() =>
          page
            .locator('video')
            .evaluate((video: HTMLVideoElement) => video.currentTime)
        )
        .toBeCloseTo(1);
      await transcript.hover();
      const sync = transcript.getByRole('button', {
        name: 'Sync to video',
        exact: true,
      });
      await expect
        .poll(async () => {
          await page.mouse.wheel(0, 600);
          return await sync.isVisible();
        })
        .toBe(true);
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d47-${theme}-${width}-sync.png`,
        });
      await sync.click();
      await expect(activeRow).toBeInViewport();
      await page
        .getByRole('button', { name: 'Show details', exact: true })
        .click();
      await expect(details).toBeVisible();
      await expect(transcript).toHaveCount(0);
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await page
        .getByRole('button', { name: 'Hide details', exact: true })
        .click();
      await expect(details).toHaveCount(0);
      await expect(transcript).toHaveCount(0);
      await toggle.click();
      await expect(transcript).toBeVisible();
      await page.setViewportSize({ width: 959, height: 900 });
      await expect(toggle).toHaveCount(0);
      await expect(transcript).toHaveCount(0);
    });
  }
}
