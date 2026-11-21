import { expect, type Locator, type Page, test } from '@playwright/test';

const CHANNEL = '11111111-1111-4111-8111-111111111111';
const OTHER_CHANNEL = '33333333-3333-4333-8333-333333333333';

type NavigationFixture = {
  tapNotification: (channelId: string) => boolean;
  openChannel: (id: string) => unknown;
  followLink: (path: string) => unknown;
  pressed: () => string[];
};

declare global {
  interface Window {
    navigationFixture: NavigationFixture;
  }
}

type BodyStyle = { pointerEvents: string; overflow: string };
let pageBody: BodyStyle;

const bodyStyle = (page: Page) =>
  page.evaluate(() => ({
    pointerEvents: getComputedStyle(document.body).pointerEvents,
    overflow: getComputedStyle(document.body).overflow,
  }));

test.beforeEach(async ({ page }) => {
  // Backend-free: a channel destination prefetches its messages, which must
  // not reach a real service.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Document' })).toBeVisible();
  pageBody = await bodyStyle(page);
});

/** Corvu starts the opening slide a frame after mount, so wait for it to end. */
async function settled(sheet: Locator) {
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).not.toHaveAttribute('data-transitioning');
}

/** No sheet left anything behind that blocks the page. */
async function expectPageInteractive(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Scroll lock and outside pointer blocking are gone with the sheets.
  expect(await bodyStyle(page)).toEqual(pageBody);

  // The front pane takes a real tap.
  await page.getByRole('button', { name: 'Reply' }).tap();
  await expect
    .poll(() => page.evaluate(() => window.navigationFixture.pressed()))
    .toEqual(['Reply']);
}

test('a notification tap closes stacked sheets and shows the channel', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Properties' }).tap();
  const properties = page.getByRole('dialog', { name: 'Properties' });
  await settled(properties);
  await properties.getByRole('button', { name: 'Assignee' }).tap();
  await settled(page.getByRole('dialog', { name: 'Assignee' }));

  await page.evaluate(
    (channel) => window.navigationFixture.tapNotification(channel),
    CHANNEL
  );

  await expect(page.getByRole('heading', { name: 'Channel' })).toBeVisible();
  await expectPageInteractive(page);
});

test('a notification tap for the channel already open closes its sheet', async ({
  page,
}) => {
  await page.evaluate(
    (channel) => window.navigationFixture.followLink(`/channel/${channel}`),
    CHANNEL
  );
  await page.getByRole('button', { name: 'Members' }).tap();
  await settled(page.getByRole('dialog', { name: 'Members' }));

  await page.evaluate(
    (channel) => window.navigationFixture.tapNotification(channel),
    CHANNEL
  );

  await expectPageInteractive(page);
});

test('opening content from code closes a dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Rename' }).tap();
  await settled(page.getByRole('dialog', { name: 'Rename document' }));

  await page.evaluate(
    (channel) => window.navigationFixture.openChannel(channel),
    OTHER_CHANNEL
  );

  await expect(page.getByRole('heading', { name: 'Channel' })).toBeVisible();
  await expectPageInteractive(page);
});

test('a link closes a sheet the app chrome owns', async ({ page }) => {
  await page.getByRole('button', { name: 'Create' }).tap();
  await settled(page.getByRole('dialog', { name: 'Create' }));

  await page.evaluate(
    (channel) => window.navigationFixture.followLink(`/channel/${channel}`),
    OTHER_CHANNEL
  );

  await expect(page.getByRole('heading', { name: 'Channel' })).toBeVisible();
  await expectPageInteractive(page);
});
