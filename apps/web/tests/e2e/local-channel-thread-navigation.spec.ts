import { expect, type Page, test } from '@playwright/test';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import { gotoApp, LOCAL_E2E } from './helpers/local-app';
import {
  delayResizeObserverFor,
  observeBottomPresentation,
  observeTargetPresentation,
} from './helpers/scroll-presentation';

const CHANNEL_SCROLL_SELECTOR = '[data-channel-scroll]';
const BOTTOM_TOLERANCE_PX = 1;
const MAX_PRESENTED_TARGET_SHIFT_PX = 2;
const LATEST_MESSAGE_TEXT = 'Scroll fixture message 5000';

test.skip(!LOCAL_E2E, 'requires the seeded local E2E stack');
test.use({ viewport: { width: 1920, height: 1080 } });

type PresentationObserver = Awaited<
  ReturnType<typeof observeTargetPresentation>
>;
type BottomPresentationObserver = Awaited<
  ReturnType<typeof observeBottomPresentation>
>;

function targetSelector(messageId: string) {
  return `[data-message-id="${messageId}"]`;
}

function channelScrollSelector(channelId: string) {
  return `${CHANNEL_SCROLL_SELECTOR}[data-channel-id="${channelId}"]`;
}

function targetUrl(channelId: string, messageId: string, threadId?: string) {
  const params = new URLSearchParams({ channel_message_id: messageId });
  if (threadId) params.set('channel_thread_id', threadId);
  return `/channel/${channelId}?${params}` as const;
}

async function expectTargetedMessage(
  page: Page,
  messageId: string,
  text: string
) {
  const target = page.locator(targetSelector(messageId));
  await expect(target).toContainText(text, { timeout: 30_000 });
  await expect(target).toHaveAttribute('data-targeted', '');
  return target;
}

async function expectStableLanding(presentation: PresentationObserver) {
  const report = await presentation.waitForQuietAndRead();
  expect(report.firstPositioned, JSON.stringify(report)).toBeDefined();
  expect(report.unpositionedBeforeLandingCount, JSON.stringify(report)).toBe(0);
  expect(report.last?.positioned, JSON.stringify(report)).toBe(true);
  expect(report.positionLossCount, JSON.stringify(report)).toBe(0);
  expect(
    report.largestShiftAfterPositioned,
    JSON.stringify(report)
  ).toBeLessThanOrEqual(MAX_PRESENTED_TARGET_SHIFT_PX);
  return report;
}

async function expectBottomLanding(
  page: Page,
  presentation: BottomPresentationObserver,
  channelId: string
) {
  const scroller = page.locator(channelScrollSelector(channelId));
  await expect(scroller).toBeVisible({ timeout: 30_000 });
  await expect(
    scroller.getByText(LATEST_MESSAGE_TEXT, { exact: true })
  ).toBeInViewport({ timeout: 30_000 });

  const report = await presentation.waitForSampleAndRead();
  expect(report.first, JSON.stringify(report)).toBeDefined();
  expect(
    report.first?.distanceFromBottom,
    JSON.stringify(report)
  ).toBeLessThanOrEqual(BOTTOM_TOLERANCE_PX);
  expect(report.firstViolation, JSON.stringify(report)).toBeUndefined();
  expect(report.violationCount, JSON.stringify(report)).toBe(0);
}

async function openChannelFromCommandMenu(page: Page, channelName: string) {
  const dialog = page.getByRole('dialog');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press('Meta+K');
    if (
      await dialog
        .waitFor({ state: 'visible', timeout: 1_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      break;
    }
  }
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByPlaceholder('Search...').fill(channelName);
  const result = dialog.getByText(channelName, { exact: true }).last();
  await expect(result).toBeVisible({ timeout: 30_000 });
  await result.click();
}

async function replaceActiveSplitWithFiles(page: Page, channelId: string) {
  await page.getByRole('button', { name: /Files/ }).click();
  await expect(page.locator('[data-list-view="documents"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(channelScrollSelector(channelId))).toHaveCount(0);
}

async function clickChannelMention(
  page: Page,
  sourceMessageId: string,
  targetChannelId: string
) {
  const sourceMessage = page.locator(targetSelector(sourceMessageId));
  await expect(sourceMessage).toBeVisible({ timeout: 30_000 });
  const mention = sourceMessage.locator(
    `[data-document-mention="true"][data-document-id="${targetChannelId}"]`
  );
  await expect(mention).toBeVisible({ timeout: 30_000 });
  await expect(mention).not.toHaveClass(/opacity-50/, { timeout: 30_000 });
  await mention.click();
}

function countChannelMessageRequests(
  page: Page,
  channelId: string,
  loadAroundMessageId: string | null
) {
  let count = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.endsWith(`/channels/${channelId}/messages`) &&
      url.searchParams.get('load_around_message_id') === loadAroundMessageId
    ) {
      count += 1;
    }
  });
  return () => count;
}

test('opens a channel from the command menu at the bottom cold and warm', async ({
  page,
}) => {
  const channel = localE2ESeed.smoke.generalChannel;
  const channelName = channel.channel_name ?? 'general';
  const otherChannel = localE2ESeed.smoke.genericMentionSourceChannel;
  const latestRequests = countChannelMessageRequests(
    page,
    channel.channel_id,
    null
  );
  const presentation = await observeBottomPresentation(
    page,
    channelScrollSelector(channel.channel_id),
    BOTTOM_TOLERANCE_PX
  );

  await gotoApp(page, '/component/documents');
  await expect(page.locator('[data-list-view="documents"]')).toBeVisible();
  await openChannelFromCommandMenu(page, channelName);
  await expectBottomLanding(page, presentation, channel.channel_id);
  expect(latestRequests()).toBeGreaterThan(0);
  const coldRequestCount = latestRequests();

  await openChannelFromCommandMenu(
    page,
    otherChannel.channel_name ?? 'announcements'
  );
  await presentation.reset();
  await openChannelFromCommandMenu(page, channelName);
  await expectBottomLanding(page, presentation, channel.channel_id);
  expect(latestRequests()).toBe(coldRequestCount);
});

test('opens a generic channel mention at the bottom cold and warm', async ({
  page,
}) => {
  const target = localE2ESeed.smoke.generalChannel;
  const source = localE2ESeed.smoke.genericMentionSourceChannel;
  const sourceName = source.channel_name ?? 'announcements';
  const latestRequests = countChannelMessageRequests(
    page,
    target.channel_id,
    null
  );
  const presentation = await observeBottomPresentation(
    page,
    channelScrollSelector(target.channel_id),
    BOTTOM_TOLERANCE_PX
  );

  await gotoApp(page, '/component/documents');
  await expect(page.locator('[data-list-view="documents"]')).toBeVisible();
  await openChannelFromCommandMenu(page, sourceName);
  await presentation.reset();
  await clickChannelMention(
    page,
    localE2ESeed.smoke.genericMentionSourceMessageId,
    target.channel_id
  );
  await expectBottomLanding(page, presentation, target.channel_id);
  expect(latestRequests()).toBeGreaterThan(0);
  const coldRequestCount = latestRequests();

  await replaceActiveSplitWithFiles(page, target.channel_id);
  await presentation.reset();
  await clickChannelMention(
    page,
    localE2ESeed.smoke.genericMentionSourceMessageId,
    target.channel_id
  );
  await expectBottomLanding(page, presentation, target.channel_id);
  expect(latestRequests()).toBe(coldRequestCount);
});

async function openChannelAtLatest(page: Page) {
  const channel = localE2ESeed.smoke.generalChannel;
  const launcherId = localE2ESeed.smoke.generalNavigationLauncherMessageId;
  await gotoApp(page, `/channel/${channel.channel_id}`);
  await expect(page.locator(CHANNEL_SCROLL_SELECTOR)).toBeVisible({
    timeout: 30_000,
  });
  const launcher = page.locator(targetSelector(launcherId));
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  const mentions = launcher.locator('[data-document-mention="true"]');
  await expect(mentions).toHaveCount(2);
  await expect(mentions.nth(0)).not.toHaveClass(/opacity-50/, {
    timeout: 30_000,
  });
  await expect(mentions.nth(1)).not.toHaveClass(/opacity-50/, {
    timeout: 30_000,
  });
  return mentions;
}

test('lands on a deeply nested reply after the thread expands and measures', async ({
  page,
}) => {
  const channel = localE2ESeed.smoke.generalChannel;
  const thread = localE2ESeed.smoke.generalDeepThread;
  const selector = targetSelector(thread.targetReplyId);
  const resizeDelay = await delayResizeObserverFor(
    page,
    CHANNEL_SCROLL_SELECTOR,
    150,
    selector
  );
  const presentation = await observeTargetPresentation(
    page,
    channelScrollSelector(channel.channel_id),
    selector
  );

  await gotoApp(
    page,
    targetUrl(channel.channel_id, thread.targetReplyId, thread.parentMessageId)
  );
  await expectTargetedMessage(
    page,
    thread.targetReplyId,
    thread.targetReplyText
  );

  const resizeFault = await resizeDelay.waitForRelease();
  expect(resizeFault?.matchedCallbacks).toBeGreaterThan(0);
  await expectStableLanding(presentation);
});

test('opens a targeted channel mention on its deeply nested reply', async ({
  page,
}) => {
  const channel = localE2ESeed.smoke.generalChannel;
  const thread = localE2ESeed.smoke.generalDeepThread;
  const source = localE2ESeed.smoke.targetedMentionSourceChannel;
  const aroundRequests = countChannelMessageRequests(
    page,
    channel.channel_id,
    thread.parentMessageId
  );
  const presentation = await observeTargetPresentation(
    page,
    channelScrollSelector(channel.channel_id),
    targetSelector(thread.targetReplyId)
  );

  await gotoApp(page, '/component/documents');
  await openChannelFromCommandMenu(page, source.channel_name ?? 'random');
  await clickChannelMention(
    page,
    localE2ESeed.smoke.targetedMentionSourceMessageId,
    channel.channel_id
  );

  await expectTargetedMessage(
    page,
    thread.targetReplyId,
    thread.targetReplyText
  );
  await expectStableLanding(presentation);
  expect(aroundRequests()).toBeGreaterThan(0);
});

test('the latest target wins while an earlier reply request is still loading', async ({
  page,
}) => {
  const channel = localE2ESeed.smoke.generalChannel;
  const staleThread = localE2ESeed.smoke.generalAlternateDeepThread;
  const finalThread = localE2ESeed.smoke.generalDeepThread;
  const staleRepliesPath = `/channels/${channel.channel_id}/messages/${staleThread.parentMessageId}/replies`;
  let releaseStaleReplies = () => {};
  const holdStaleReplies = new Promise<void>((resolve) => {
    releaseStaleReplies = resolve;
  });
  await page.route(`**${staleRepliesPath}*`, async (route) => {
    await holdStaleReplies;
    await route.continue();
  });
  const presentation = await observeTargetPresentation(
    page,
    channelScrollSelector(channel.channel_id),
    targetSelector(finalThread.targetReplyId)
  );
  const mentions = await openChannelAtLatest(page);
  const splitPanels = page.locator('[data-split-id]');
  const splitCount = await splitPanels.count();
  const staleRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith(staleRepliesPath)
  );
  await mentions.nth(0).click({ modifiers: ['Shift'] });
  await staleRequest;

  // The stale thread's root is mounted before its delayed replies resolve. Its
  // real channel mention remains interactive while that request is in flight.
  const staleParent = page.locator(targetSelector(staleThread.parentMessageId));
  const finalMention = staleParent.locator('[data-document-mention="true"]');
  await expect(finalMention).toBeVisible();
  await finalMention.click({ modifiers: ['Shift'] });
  releaseStaleReplies();
  await expect(splitPanels).toHaveCount(splitCount);

  await expectTargetedMessage(
    page,
    finalThread.targetReplyId,
    finalThread.targetReplyText
  );
  await expect(
    page.locator(`${targetSelector(staleThread.targetReplyId)}[data-targeted]`)
  ).toHaveCount(0);
  await expectStableLanding(presentation);
});

test('loads and lands on a top-level target outside the initial message window', async ({
  page,
}) => {
  const channel = localE2ESeed.smoke.generalChannel;
  const thread = localE2ESeed.smoke.generalDeepThread;
  const presentation = await observeTargetPresentation(
    page,
    channelScrollSelector(channel.channel_id),
    targetSelector(thread.parentMessageId)
  );

  await gotoApp(page, targetUrl(channel.channel_id, thread.parentMessageId));
  await expectTargetedMessage(
    page,
    thread.parentMessageId,
    'Deep thread navigation fixture parent'
  );
  await expectStableLanding(presentation);
});

test('reopens at latest after a load-around channel mount is closed', async ({
  page,
}) => {
  const channel = localE2ESeed.smoke.generalChannel;
  const channelName = channel.channel_name ?? 'general';
  const targetMessageId = localE2ESeed.smoke.generalDeepThread.parentMessageId;
  const aroundRequests = countChannelMessageRequests(
    page,
    channel.channel_id,
    targetMessageId
  );
  const latestRequests = countChannelMessageRequests(
    page,
    channel.channel_id,
    null
  );
  const presentation = await observeBottomPresentation(
    page,
    channelScrollSelector(channel.channel_id),
    BOTTOM_TOLERANCE_PX
  );

  await gotoApp(page, targetUrl(channel.channel_id, targetMessageId));
  await expectTargetedMessage(
    page,
    targetMessageId,
    'Deep thread navigation fixture parent'
  );
  expect(aroundRequests()).toBeGreaterThan(0);
  const loadAroundRequestCount = aroundRequests();

  await replaceActiveSplitWithFiles(page, channel.channel_id);
  await presentation.reset();
  await openChannelFromCommandMenu(page, channelName);

  await expectBottomLanding(page, presentation, channel.channel_id);
  expect(latestRequests()).toBeGreaterThan(0);
  expect(aroundRequests()).toBe(loadAroundRequestCount);
  await expect(
    page.locator(`${CHANNEL_SCROLL_SELECTOR} [data-targeted]`)
  ).toHaveCount(0);
});

test('opens an unread channel notification on its specific cached reply', async ({
  page,
}) => {
  const channel = localE2ESeed.smoke.generalChannel;
  const navigation = localE2ESeed.smoke.unreadMessageNavigation;
  const source = localE2ESeed.smoke.unreadMentionSourceChannel;
  const aroundRequests = countChannelMessageRequests(
    page,
    channel.channel_id,
    navigation.parentMessageId
  );
  const presentation = await observeTargetPresentation(
    page,
    channelScrollSelector(channel.channel_id),
    targetSelector(navigation.targetReplyId)
  );
  // Warming this thread mounts the notified reply, which normally marks the
  // notification seen. Force the real mutation rollback path so the sidebar
  // entry remains available for the interaction under test and for repeats.
  await page.route(
    '**/notification/user_notifications/bulk/seen',
    async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'preserve seeded unread fixture' }),
      });
    }
  );

  await gotoApp(page, '/component/documents');
  await openChannelFromCommandMenu(
    page,
    source.channel_name ?? navigation.sourceChannelName
  );
  await clickChannelMention(
    page,
    navigation.sourceMessageId,
    channel.channel_id
  );
  await expectTargetedMessage(
    page,
    navigation.cacheWarmerReplyId,
    navigation.cacheWarmerReplyText
  );
  expect(aroundRequests()).toBeGreaterThan(0);
  const coldRequestCount = aroundRequests();

  const unreadSection = page.locator('section').filter({
    has: page.getByRole('button', { name: 'Unread', exact: true }),
  });
  const unreadChannel = unreadSection.getByRole('button', {
    name: /general/,
  });
  await expect(unreadChannel).toBeVisible({ timeout: 30_000 });
  await presentation.reset();
  await unreadChannel.click();
  await expectTargetedMessage(
    page,
    navigation.targetReplyId,
    navigation.targetReplyText
  );
  const report = await expectStableLanding(presentation);
  expect(report.last?.targetHeight).toBeGreaterThan(
    report.last?.usableViewportHeight ?? Number.POSITIVE_INFINITY
  );
  expect(aroundRequests()).toBe(coldRequestCount);
});

test.describe('mobile channel viewport', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('lands inside the viewport between floating channel chrome', async ({
    page,
  }) => {
    const channel = localE2ESeed.smoke.generalChannel;
    const thread = localE2ESeed.smoke.generalDeepThread;
    const presentation = await observeTargetPresentation(
      page,
      channelScrollSelector(channel.channel_id),
      targetSelector(thread.targetReplyId)
    );

    await gotoApp(
      page,
      targetUrl(
        channel.channel_id,
        thread.targetReplyId,
        thread.parentMessageId
      )
    );
    await expectTargetedMessage(
      page,
      thread.targetReplyId,
      thread.targetReplyText
    );
    const report = await expectStableLanding(presentation);
    expect(report.last?.insetStart).toBeGreaterThan(0);
    expect(report.last?.insetEnd).toBeGreaterThan(0);
  });
});
