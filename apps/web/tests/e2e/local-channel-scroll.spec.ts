import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { entityIdSelector } from '../../src/lib/core/dom-selectors';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import {
  expectEntityInCurrentList,
  gotoApp,
  LOCAL_E2E,
} from './helpers/local-app';
import {
  delayResizeObserverFor,
  observeBottomPresentation,
  observeMountedThreads,
} from './helpers/scroll-presentation';

const CHANNEL_SCROLL_SELECTOR = '[data-channel-scroll]';
const BOTTOM_TOLERANCE_PX = 1;
const MAX_TRANSIENT_MESSAGES = 32;
const MAX_TRANSIENT_THREADS = 8;

test.skip(!LOCAL_E2E, 'requires the seeded local E2E stack');
test.use({ viewport: { width: 1920, height: 1080 } });

function scrollFixtureMessageId(channelId: string, messageNumber: number) {
  const hex = createHash('md5')
    .update(`local-e2e-scroll-${channelId}-${messageNumber}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

test('does not transiently mount rows outside a reply-heavy viewport', async ({
  page,
}) => {
  const channelId = localE2ESeed.smoke.generalChannel.channel_id;
  const targetMessageId = scrollFixtureMessageId(channelId, 2475);
  const scrollSelector = `${CHANNEL_SCROLL_SELECTOR}[data-channel-id="${channelId}"]`;
  const mountedThreads = await observeMountedThreads(page, scrollSelector);

  await gotoApp(
    page,
    `/channel/${channelId}?channel_message_id=${targetMessageId}`
  );

  const scroller = page.locator(scrollSelector);
  await expect(scroller).toBeVisible({ timeout: 30_000 });
  await expect(
    scroller.locator(`[data-message-id="${targetMessageId}"]`)
  ).toBeVisible({ timeout: 30_000 });

  const report = await mountedThreads.waitForQuietAndRead();
  expect(report.currentThreads).toBeGreaterThan(0);
  expect(report.peakThreads, JSON.stringify(report)).toBeLessThanOrEqual(
    MAX_TRANSIENT_THREADS
  );
  expect(report.peakMessages, JSON.stringify(report)).toBeLessThanOrEqual(
    MAX_TRANSIENT_MESSAGES
  );
});

test('presents an overflowing channel at the bottom before measurement settles', async ({
  page,
}) => {
  const resizeDelay = await delayResizeObserverFor(
    page,
    CHANNEL_SCROLL_SELECTOR,
    150
  );
  const presentation = await observeBottomPresentation(
    page,
    CHANNEL_SCROLL_SELECTOR,
    BOTTOM_TOLERANCE_PX
  );

  const channel = localE2ESeed.smoke.generalChannel;
  const channelName = channel.channel_name ?? 'general';

  await gotoApp(page, '/component/channels');
  await expectEntityInCurrentList(page, channel.channel_id, channelName);
  await page.locator(entityIdSelector(channel.channel_id)).first().click();

  await expect(page).toHaveURL(
    new RegExp(`/app/channel/${channel.channel_id}(?:[/?#]|$)`)
  );

  const scroller = page.locator(CHANNEL_SCROLL_SELECTOR);
  await expect(scroller).toBeVisible({ timeout: 30_000 });
  const resizeFault = await resizeDelay.waitForRelease();
  await expect(
    page.getByText('Scroll fixture message 5000', { exact: true })
  ).toBeInViewport({ timeout: 30_000 });

  const report = await presentation.read();
  expect(resizeFault?.matchedCallbacks).toBeGreaterThan(0);
  expect(resizeFault?.releaseAt).toBeDefined();
  expect(report.first).toBeDefined();

  expect(report.first?.distanceFromBottom).toBeLessThanOrEqual(
    BOTTOM_TOLERANCE_PX
  );
  expect(report.first?.time).toBeLessThan(resizeFault?.releaseAt ?? 0);
  expect(report.firstViolation).toBeUndefined();
  expect(report.violationCount).toBe(0);
});
