import { expect, test } from '@playwright/test';

const fixture = '/src/features/block-call/browser-test/view.html';

for (const theme of ['light', 'dark']) {
  for (const { width, height } of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
  ]) {
    test(`saved call uses the pane width and keeps its transcript (${theme}, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${fixture}?theme=${theme}`);
      const card = page.getByRole('complementary', { name: 'Transcript' });
      const tabs = page.getByRole('radio', { name: 'Transcript' });
      const pane = page.locator('#fixture-pane');
      const column = pane.locator('.\\@container\\/call-column');
      const columnWidth = await column.evaluate(
        (element) => element.clientWidth
      );
      expect(columnWidth).toBe(width - 330);
      await expect(page.locator('video')).toHaveCount(1);
      await expect(
        page.getByText('Playback has one transcript line.')
      ).toHaveCount(1);
      await expect(page.getByText('Conversation recap')).toBeVisible();
      if (columnWidth >= 1108) {
        await expect(card).toBeVisible();
        await expect(card).toHaveCSS('opacity', '1');
        await expect(tabs).toBeHidden();
        const geometry = await card.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const player = document
            .querySelector('video')!
            .getBoundingClientRect();
          const column = element
            .closest('.\\@container\\/call-column')!
            .getBoundingClientRect();
          const title = document.querySelector('h1')!.getBoundingClientRect();
          return {
            width: rect.width,
            topDifference: Math.abs(rect.top - player.top),
            rightPadding: column.right - rect.right,
            background: getComputedStyle(element).backgroundColor,
            pageBackground: getComputedStyle(document.body).backgroundColor,
            border: getComputedStyle(element).borderTopWidth,
            shadow: getComputedStyle(element).boxShadow,
            radius: getComputedStyle(element).borderRadius,
            playerRadius: getComputedStyle(
              document.querySelector('video')!.parentElement!
            ).borderRadius,
            bottomGap: column.bottom - rect.bottom,
            playerWidth: player.width,
            gap: rect.left - player.right,
            leftPadding: player.left - column.left,
            titleLeft: title.left - player.left,
            titleRight: title.right - rect.right,
          };
        });
        expect(geometry.width).toBe(480);
        expect(geometry.topDifference).toBeLessThan(3);
        expect(geometry.gap).toBe(28);
        expect(geometry.leftPadding).toBe(geometry.rightPadding);
        expect(geometry.leftPadding).toBeGreaterThanOrEqual(40);
        expect(geometry.titleLeft).toBe(0);
        expect(geometry.titleRight).toBe(0);
        expect(geometry.background).not.toBe(geometry.pageBackground);
        expect(geometry.border).toBe('0px');
        expect(geometry.shadow).toBe('none');
        expect(geometry.radius).toBe(geometry.playerRadius);
        expect(geometry.bottomGap).toBe(16);
        expect(geometry.playerWidth).toBeGreaterThanOrEqual(520);
        // The original 800px content wrapper includes two 40px page insets.
        expect(geometry.playerWidth).toBeLessThanOrEqual(720);
        expect(geometry.playerWidth).toBe(Math.min(720, columnWidth - 588));
        const utterance = card.getByText(
          'We can follow up on those changes tomorrow.'
        );
        expect(
          await utterance.evaluate(
            (element) => element.getBoundingClientRect().height
          )
        ).toBe(20);
      } else {
        await expect(card).toBeHidden();
        await expect(tabs).toBeVisible();
        await expect(
          page.getByRole('radio', { name: 'Summary' })
        ).toBeChecked();
      }
      if (width === 1024) {
        await page
          .locator('label')
          .filter({ hasText: /^Transcript$/ })
          .click();
        await expect(tabs).toBeChecked();
        await expect(card).toBeVisible();
        await expect(card).toHaveCSS('opacity', '1');
      }
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/${process.env.CALL_PLAYBACK_SCREENSHOT_PREFIX ?? 'call-layout'}-${theme}-${width}.png`,
        });
    });
  }

  test(`split pane switches at 1108px without remounting playback or losing the selected tab (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${fixture}?theme=${theme}&pane=1108`);
    const pane = page.locator('#fixture-pane');
    const video = page.locator('video');
    const card = page.getByRole('complementary', { name: 'Transcript' });
    const transcript = page.getByRole('radio', { name: 'Transcript' });
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS('opacity', '1');
    await expect(video).toHaveJSProperty('readyState', 4);
    await card
      .getByRole('button', { name: /Playback has one transcript line/ })
      .click();
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime)
      )
      .toBeCloseTo(1);
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.playbackRate = 0.1;
      await element.play();
    });
    await expect(video).toHaveJSProperty('paused', false);
    await video.evaluate((element: HTMLVideoElement) => {
      element.dataset.mount = 'original';
    });
    await card
      .locator('[data-call-transcript-row]')
      .first()
      .evaluate((element) => {
        element.setAttribute('data-mount', 'original');
      });
    await pane.evaluate((element: HTMLElement) => {
      element.style.maxWidth = '1107px';
    });
    await expect(transcript).toBeVisible();
    await expect(card).toBeHidden();
    await expect(page.getByRole('radio', { name: 'Summary' })).toBeChecked();
    await page
      .locator('label')
      .filter({ hasText: /^Transcript$/ })
      .click();
    await expect(transcript).toBeChecked();
    await expect(
      page.getByText('Playback has one transcript line.')
    ).toHaveCount(1);
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute('data-mount', 'original');
    await expect(
      card.locator('[data-call-transcript-row]').first()
    ).toHaveAttribute('data-mount', 'original');
    await expect(video).toHaveJSProperty('paused', false);
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime)
      )
      .toBeGreaterThanOrEqual(1);
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/${process.env.CALL_PLAYBACK_SCREENSHOT_PREFIX ?? 'call-layout'}-${theme}-pane-1107.png`,
      });
    await pane.evaluate((element: HTMLElement) => {
      element.style.maxWidth = '1108px';
    });
    await expect(transcript).toBeHidden();
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS('opacity', '1');
    expect(
      await video.evaluate((element) => element.getBoundingClientRect().width)
    ).toBe(520);
    await expect(video).toHaveAttribute('data-mount', 'original');
    await expect(
      card.locator('[data-call-transcript-row]').first()
    ).toHaveAttribute('data-mount', 'original');
    await expect(
      page.getByText('Playback has one transcript line.')
    ).toHaveCount(1);
    await expect(video).toHaveCount(1);
    await expect(video).toHaveJSProperty('paused', false);
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime)
      )
      .toBeGreaterThanOrEqual(1);
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/${process.env.CALL_PLAYBACK_SCREENSHOT_PREFIX ?? 'call-layout'}-${theme}-pane-1108.png`,
      });
    await pane.evaluate((element: HTMLElement) => {
      element.style.maxWidth = '1107px';
    });
    await expect(transcript).toBeChecked();
    await expect(video).toHaveCount(1);
    await expect(video).toHaveJSProperty('paused', false);
  });

  test(`transcript card syncs, stays visible while summary scrolls, and survives details (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${fixture}?theme=${theme}`);
    const card = page.getByRole('complementary', { name: 'Transcript' });
    const details = page.getByRole('complementary', { name: 'Block details' });
    const video = page.locator('video');
    const row = card.getByRole('button', {
      name: /Playback has one transcript line/,
    });
    await row.click();
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime)
      )
      .toBeCloseTo(1);
    const scroller = card.locator('.overflow-y-auto');
    await scroller.hover();
    await page.mouse.wheel(0, 700);
    const sync = card.getByRole('button', { name: 'Sync to video' });
    await expect(sync).toBeVisible();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(300);
    const scrollTop = await scroller.evaluate((element) => element.scrollTop);
    await page.getByRole('button', { name: 'Show details' }).click();
    await expect(details).toBeVisible();
    await expect(details).toHaveCSS('opacity', '1');
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS('opacity', '1');
    const overlap = await details.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const transcript = document
        .querySelector('aside[aria-label="Transcript"]')!
        .getBoundingClientRect();
      const left = Math.max(rect.left, transcript.left);
      const top = Math.max(rect.top, transcript.top);
      const right = Math.min(rect.right, transcript.right);
      const bottom = Math.min(rect.bottom, transcript.bottom);
      return (
        right > left &&
        bottom > top &&
        element.contains(
          document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
        )
      );
    });
    expect(overlap).toBe(true);
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/${process.env.CALL_PLAYBACK_SCREENSHOT_PREFIX ?? 'call-layout'}-${theme}-details.png`,
      });
    await page.getByRole('button', { name: 'Hide details' }).click();
    await expect(details).toHaveCount(0);
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(
      scrollTop
    );
    await expect(sync).toBeVisible();
    await sync.click();
    await expect(row).toBeInViewport();
    await expect(sync).toBeHidden();
    const left = page.locator('[data-recording-scroll="content"]');
    await left.hover();
    await page.mouse.wheel(0, 650);
    await expect
      .poll(() => left.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(300);
    const pinned = page
      .getByRole('group', { name: 'Recording playback' })
      .filter({
        has: page.getByRole('button', { name: 'Show video' }),
      });
    await expect(pinned).toBeVisible();
    const playbackBounds = await pinned.boundingBox();
    const columnBounds = await left.boundingBox();
    expect(playbackBounds?.x).toBe(columnBounds?.x);
    expect(playbackBounds?.width).toBe(columnBounds?.width);
    await expect(card).toBeInViewport();
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/${process.env.CALL_PLAYBACK_SCREENSHOT_PREFIX ?? 'call-layout'}-${theme}-left-scrolled.png`,
      });
  });
}
