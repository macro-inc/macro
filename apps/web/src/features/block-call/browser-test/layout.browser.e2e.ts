import { expect, test } from '@playwright/test';

const FIXTURE = '/src/features/block-call/browser-test/view.html';

for (const theme of ['light', 'dark']) {
  test(`left scrolling leaves the transcript card in place (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${FIXTURE}?theme=${theme}`);
    const card = page.getByRole('complementary', { name: 'Transcript' });
    const content = page.locator('[data-recording-scroll="content"]');
    const transcriptScroll = card.locator('.overflow-y-auto');
    const before = await card.boundingBox();
    await content.hover();
    await page.mouse.wheel(0, 650);
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(300);
    await expect(transcriptScroll).toHaveJSProperty('scrollTop', 0);
    await expect(card).toBeInViewport();
    expect(await card.boundingBox()).toEqual(before);
    await expect(
      page.getByRole('button', { name: 'Show video', exact: true })
    ).toBeVisible();
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d54-${theme}-left-scrolled.png`,
      });
    await page.getByRole('button', { name: 'Show video', exact: true }).click();
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBe(0);
  });

  test(`narrow Summary never exposes the transcript (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${FIXTURE}?theme=${theme}&pane=1028`);
    const card = page.getByRole('complementary', { name: 'Transcript' });
    await expect(card).toBeVisible();
    await page.locator('#fixture-pane').evaluate((element: HTMLElement) => {
      element.style.maxWidth = '1027px';
    });
    await expect(
      page.getByRole('radio', { name: 'Summary', exact: true })
    ).toBeVisible();
    await expect(card).toBeHidden();
    await expect(page.getByText('Conversation recap')).toBeVisible();
  });
}

for (const width of [390, 480, 680]) {
  test(`narrow reading tabs retain inline transcript behavior (${width}px)`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: width === 390 ? 390 : 1440, height: 844 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${FIXTURE}?pane=${width}`);
      const transcript = page.getByRole('complementary', {
        name: 'Transcript',
      });
      await expect(transcript).toBeHidden();
      await page
        .locator('label')
        .filter({ hasText: /^Transcript$/ })
        .click();
      await expect(transcript).toBeVisible();
      await transcript
        .getByRole('button', { name: /Playback has one transcript line/ })
        .click();
      await expect
        .poll(() =>
          page
            .locator('video')
            .evaluate((element: HTMLVideoElement) => element.currentTime)
        )
        .toBeCloseTo(1);
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d54-inline-${width}.png`,
        });
    } finally {
      await context.close();
    }
  });
}
