import { expect, type Page, test } from '@playwright/test';
import { gotoApp, LOCAL_E2E, uniqueE2EText } from './helpers/local-app';
import { observeBottomPresentation } from './helpers/scroll-presentation';

const CHANNEL_SCROLL_SELECTOR = '[data-channel-scroll]';
const BOTTOM_TOLERANCE_PX = 1;

const composer = (page: Page, channelId: string) =>
  page.locator(
    `[data-input-id="channel-input-${channelId}"] [contenteditable="true"]`
  );

async function sendMessage(page: Page, channelId: string, text: string) {
  const input = composer(page, channelId);
  await input.fill(text);
  const sent = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/channels/${channelId}/message`)
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  expect((await sent).ok()).toBe(true);
  await expect(input).toHaveText('');
}

async function createOverflowingChannel(page: Page) {
  await gotoApp(page, '/component/channels');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Channel/ }).click();
  await page.getByPlaceholder('Channel name').fill(uniqueE2EText('Scroll pin'));
  await page
    .getByRole('button', { name: 'Create Channel', exact: true })
    .click();
  await page.waitForURL(/\/channel\/[a-f0-9-]+$/);
  const channelId = page.url().split('/').at(-1)!;
  for (let index = 0; index < 32; index++) {
    await sendMessage(page, channelId, `History message ${index}`);
  }
  return channelId;
}

async function positionFromBottom(page: Page, gap: number) {
  const scroller = page.locator(CHANNEL_SCROLL_SELECTOR);
  await scroller.evaluate((element, gap) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - gap;
  }, gap);
  await expect
    .poll(async () => Math.abs((await scrollPosition(page)).gap - gap))
    .toBeLessThanOrEqual(BOTTOM_TOLERANCE_PX);
  // Let native scrollend and the physical-intent timeout settle.
  await page.waitForTimeout(350);
}

function scrollPosition(page: Page) {
  return page.locator(CHANNEL_SCROLL_SELECTOR).evaluate((element) => ({
    top: element.scrollTop,
    gap: element.scrollHeight - element.clientHeight - element.scrollTop,
  }));
}

test.skip(!LOCAL_E2E, 'requires a local stack');

test('stays pinned throughout consecutive sends and server acknowledgements', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const presentation = await observeBottomPresentation(
    page,
    CHANNEL_SCROLL_SELECTOR,
    BOTTOM_TOLERANCE_PX
  );
  const channelId = await createOverflowingChannel(page);
  await positionFromBottom(page, 0);
  await presentation.reset();

  for (let index = 0; index < 6; index++) {
    // Exercise Enter as well as the send button used by the shared helper.
    const input = composer(page, channelId);
    await input.fill(`Consecutive send ${index}`);
    const sent = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/channels/${channelId}/message`)
    );
    await input.press('Enter');
    expect((await sent).ok()).toBe(true);
    await page.waitForTimeout(250);
  }
  // Fast paste-and-send must include the composer resize, not wait it out.
  await sendMessage(page, channelId, 'A wrapped message. '.repeat(50));
  await page.waitForTimeout(250);
  await sendMessage(
    page,
    channelId,
    Array.from({ length: 22 }, (_, index) => `Tall message line ${index}`).join(
      '\n'
    )
  );
  await page.waitForTimeout(250);
  await sendMessage(page, channelId, 'Short again 🙂');
  await page.waitForTimeout(350);

  const report = await presentation.read();
  expect(report.first).toBeDefined();
  expect(report.firstViolation).toBeUndefined();
  expect(report.violationCount).toBe(0);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
  { width: 844, height: 390 },
]) {
  test(`touch mobile ${viewport.width}×${viewport.height}: sends, small scrolls, and resizing`, async ({
    page: setupPage,
    browser,
    context: setupContext,
  }) => {
    test.setTimeout(120_000);
    const channelId = await createOverflowingChannel(setupPage);
    const context = await browser.newContext({
      storageState: await setupContext.storageState(),
      viewport,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    try {
      const page = await context.newPage();
      const presentation = await observeBottomPresentation(
        page,
        CHANNEL_SCROLL_SELECTOR,
        BOTTOM_TOLERANCE_PX
      );
      await page.goto(setupPage.url());
      const input = composer(page, channelId);
      const collapsedInput = page.getByRole('button', {
        name: /Type @ to share/,
      });
      await expect(
        input.or(collapsedInput).filter({ visible: true }).first()
      ).toBeVisible();
      if (await collapsedInput.isVisible()) await collapsedInput.tap();
      await expect(input).toBeVisible();
      await positionFromBottom(page, 0);
      await presentation.reset();
      for (const text of [
        'Mobile send one',
        'Mobile send two',
        'Mobile send three',
        'Wrapped mobile text. '.repeat(40),
        'After wrapping',
        Array.from({ length: 22 }, (_, index) => `Tall line ${index}`).join(
          '\n'
        ),
        'After tall 🙂',
      ]) {
        await input.fill(text);
        const sent = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith(`/channels/${channelId}/message`)
        );
        await page
          .getByRole('button', { name: 'Send message', exact: true })
          .tap();
        expect((await sent).ok()).toBe(true);
        await page.waitForTimeout(350);
      }
      const report = await presentation.read();
      expect(report.first).toBeDefined();
      expect(report.firstViolation).toBeUndefined();
      expect(report.violationCount).toBe(0);

      // The same end tolerance must govern appends and floating composer growth.
      for (const gap of [0, 1, 2, 10, 25, 49, 50, 51, 100, 420]) {
        await test.step(`${gap}px from bottom`, async () => {
          await positionFromBottom(page, gap);
          const before = await scrollPosition(page);
          await sendMessage(page, channelId, 'Small scroll check');
          await page.waitForTimeout(350);
          const after = await scrollPosition(page);
          if (gap <= BOTTOM_TOLERANCE_PX) {
            expect(after.gap).toBeLessThanOrEqual(BOTTOM_TOLERANCE_PX);
          } else {
            expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(
              BOTTOM_TOLERANCE_PX
            );
          }
        });
      }
      for (const gap of [0, 2, 10, 49, 51, 420]) {
        await positionFromBottom(page, gap);
        const before = await scrollPosition(page);
        await input.fill('Growing composer. '.repeat(40));
        await page.waitForTimeout(350);
        const after = await scrollPosition(page);
        if (gap === 0) {
          expect(after.gap).toBeLessThanOrEqual(BOTTOM_TOLERANCE_PX);
        } else {
          expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(
            BOTTOM_TOLERANCE_PX
          );
        }
        await input.fill('');
        await page.waitForTimeout(350);
      }
      // Model the viewport contraction of a keyboard; native OS keyboard
      // events and momentum still require a physical-device check.
      for (const gap of [0, 10, 51, 420]) {
        await positionFromBottom(page, gap);
        const before = await scrollPosition(page);
        await page.setViewportSize({
          ...viewport,
          height: viewport.height - 150,
        });
        await page.waitForTimeout(350);
        const after = await scrollPosition(page);
        if (gap === 0) {
          expect(after.gap).toBeLessThanOrEqual(BOTTOM_TOLERANCE_PX);
        } else {
          expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(
            BOTTOM_TOLERANCE_PX
          );
        }
        await page.setViewportSize(viewport);
        await page.waitForTimeout(350);
      }
    } finally {
      await context.close();
    }
  });
}
