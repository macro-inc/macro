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
} from './helpers/scroll-presentation';

const CHANNEL_SCROLL_SELECTOR = '[data-channel-scroll]';
const BOTTOM_TOLERANCE_PX = 1;

test.skip(!LOCAL_E2E, 'requires the seeded local E2E stack');

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
