import { expect, test } from '@playwright/test';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import { gotoApp, LOCAL_E2E } from './helpers/local-app';

type ScrollSample = {
  time: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceFromBottom: number;
};

declare global {
  interface Window {
    __channelScrollSamples?: ScrollSample[];
  }
}

test.skip(!LOCAL_E2E, 'requires the seeded local E2E stack');

test('opens a channel at the bottom on its first overflowing frame', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const samples: ScrollSample[] = [];
    window.__channelScrollSamples = samples;
    let previous = '';
    let sawOverflowingFrame = false;

    const sample = () => {
      const scroller = document.querySelector<HTMLElement>(
        '[data-channel-scroll]'
      );
      if (scroller && scroller.scrollHeight > scroller.clientHeight) {
        const next: ScrollSample = {
          time: performance.now(),
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
          distanceFromBottom:
            scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        };
        const signature = `${next.scrollTop}:${next.scrollHeight}:${next.clientHeight}`;
        // The first rAF that sees the scroller runs before that frame paints.
        // Start recording on the following rAF so the first sample describes
        // the first frame the user could actually have seen.
        if (sawOverflowingFrame && signature !== previous) {
          samples.push(next);
          previous = signature;
        }
        sawOverflowingFrame = true;
      }
      requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });

  const channelId = localE2ESeed.smoke.generalChannel.channel_id;
  await gotoApp(page, `/channel/${channelId}`);
  await expect(page.getByText('Scroll fixture message 60')).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1_100);

  const samples = await page.evaluate(
    () => window.__channelScrollSamples ?? []
  );
  expect(samples.length).toBeGreaterThan(0);
  expect(samples[0]?.distanceFromBottom).toBeLessThanOrEqual(1);
  expect(samples.at(-1)?.distanceFromBottom).toBeLessThanOrEqual(1);
});
