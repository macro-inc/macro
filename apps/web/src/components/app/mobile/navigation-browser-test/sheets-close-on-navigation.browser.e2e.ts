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
  await expect(page.getByRole('menu')).toHaveCount(0);
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

/**
 * Overlays built on Kobalte rather than a sheet: portaled to the body and
 * owned by the page, which phones keep mounted behind the channel.
 */
const PAGE_OVERLAYS: {
  name: string;
  open: (page: Page) => Promise<void>;
  overlay: (page: Page) => Locator;
}[] = [
  {
    name: 'the photo viewer',
    open: (page) => page.getByRole('button', { name: 'Photo' }).tap(),
    overlay: (page) => page.getByRole('dialog'),
  },
  {
    name: 'an image viewer that holds its own open state',
    open: (page) => page.getByTestId('gallery').getByRole('button').tap(),
    overlay: (page) => page.getByRole('dialog'),
  },
  {
    name: 'a menu',
    open: (page) => page.getByRole('button', { name: 'Options' }).tap(),
    overlay: (page) => page.getByRole('menuitem', { name: 'Duplicate' }),
  },
  {
    name: 'the share dialog',
    open: (page) => page.getByRole('button', { name: 'Share' }).tap(),
    overlay: (page) => page.getByRole('heading', { name: 'Share document' }),
  },
  {
    name: 'the create menu',
    open: (page) => page.getByRole('button', { name: 'New' }).tap(),
    overlay: (page) => page.getByRole('button', { name: 'Note' }),
  },
];

for (const overlay of PAGE_OVERLAYS) {
  test(`a notification tap closes ${overlay.name}`, async ({ page }) => {
    await overlay.open(page);
    await expect(overlay.overlay(page)).toBeVisible();
    // On phones the share dialog is a sheet: let its opening slide end.
    await expect(page.locator('[data-transitioning]')).toHaveCount(0);

    await page.evaluate(
      (channel) => window.navigationFixture.tapNotification(channel),
      CHANNEL
    );

    await expect(page.getByRole('heading', { name: 'Channel' })).toBeVisible();
    await expect(overlay.overlay(page)).toHaveCount(0);
    await expectPageInteractive(page);
  });
}
