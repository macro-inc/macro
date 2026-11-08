import { writeFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';

function captureTransition(page: Page, hidden: boolean) {
  return page.evaluate((targetHidden) => {
    const bar = document.querySelector<HTMLElement>(
      '[data-recording-controls]'
    )!;
    const root = bar.closest<HTMLElement>('[aria-hidden]')!;
    const animated = getComputedStyle(bar).transitionProperty.includes(
      'opacity'
    )
      ? bar
      : root;
    const video = document.querySelector('video')!;
    const outside = document.querySelector('#outside')!;
    const initial = bar.getBoundingClientRect();
    const frames: Array<{
      time: number;
      top: number;
      opacity: number;
      videoTop: number;
      outsideTop: number;
    }> = [];
    return new Promise<{
      height: number;
      duration: string;
      easing: string;
      properties: string;
      frames: typeof frames;
    }>((resolve) => {
      const observer = new MutationObserver(() => {
        if (root.getAttribute('aria-hidden') !== String(targetHidden)) return;
        observer.disconnect();
        const style = getComputedStyle(animated);
        const start = performance.now();
        const sample = () => {
          const time = performance.now() - start;
          frames.push({
            time,
            top: bar.getBoundingClientRect().top,
            opacity: Number(getComputedStyle(animated).opacity),
            videoTop: video.getBoundingClientRect().top,
            outsideTop: outside.getBoundingClientRect().top,
          });
          if (time < 320) requestAnimationFrame(sample);
          else
            resolve({
              height: initial.height,
              duration: style.transitionDuration,
              easing: style.transitionTimingFunction,
              properties: style.transitionProperty,
              frames,
            });
        };
        sample();
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: ['aria-hidden'],
      });
    });
  }, hidden);
}

for (const touch of [false, true]) {
  test.describe(touch ? 'phone' : 'desktop', () => {
    test.use({
      hasTouch: touch,
      viewport: { width: touch ? 390 : 1280, height: 844 },
    });
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`control motion follows its own height without reflow (${reducedMotion})`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion });
        await page.goto('/src/features/block-call/browser-test/playback.html');
        const video = page.locator('video');
        await expect(video).toHaveJSProperty('readyState', 4);
        const bar = page.locator('[data-recording-controls]');
        await bar.evaluate((element) =>
          element.setAttribute('data-same-controls', 'true')
        );
        const hideCapture = captureTransition(page, true);
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await video.hover({ position: { x: 20, y: 20 } });
        const hide = await hideCapture;
        const showCapture = captureTransition(page, false);
        await video.hover({ position: { x: 40, y: 20 } });
        const show = await showCapture;
        if (process.env.CALL_MOTION_TRACE_PREFIX) {
          await writeFile(
            `${process.env.CALL_MOTION_TRACE_PREFIX}-${touch ? 'phone' : 'desktop'}-${reducedMotion}.json`,
            JSON.stringify({ hide, show }, null, 2)
          );
        }
        if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR) {
          await page.screenshot({
            path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d52-${touch ? 'phone' : 'desktop'}-${reducedMotion}-shown.png`,
          });
        }
        for (const transition of [hide, show]) {
          expect(transition.duration).toBe('0.24s');
          expect(transition.easing).toBe('cubic-bezier(0.2, 0, 0, 1)');
          expect(transition.properties).toBe('transform, opacity');
          expect(
            new Set(transition.frames.map((frame) => frame.videoTop)).size
          ).toBe(1);
          expect(
            new Set(transition.frames.map((frame) => frame.outsideTop)).size
          ).toBe(1);
          const travel = Math.abs(
            transition.frames.at(-1)!.top - transition.frames[0].top
          );
          expect(travel).toBeCloseTo(
            reducedMotion === 'reduce' ? 0 : transition.height,
            0
          );
          expect(
            transition.frames.filter(
              (frame) => frame.opacity > 0 && frame.opacity < 1
            ).length
          ).toBeGreaterThan(2);
        }
        await expect(bar).toHaveAttribute('data-same-controls', 'true');
      });
    }
  });
}
