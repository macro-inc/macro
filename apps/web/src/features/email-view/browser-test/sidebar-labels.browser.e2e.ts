import { expect, type Page, test } from '@playwright/test';

const SIZES = [
  { name: 'desktop', width: 1100, height: 800, touch: false },
  { name: 'phone', width: 390, height: 1500, touch: true },
];

async function open(page: Page) {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    // The dev server proxies this prefix to the hosted dev backend.
    if (
      url.hostname !== 'localhost' ||
      url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.abort();
      return;
    }
    await route.fulfill({ response: await route.fetch() });
  });
  await page.goto('/src/features/email-view/browser-test/sidebar-labels.html');
  await expect(
    page.getByTestId('one-inbox').getByText('Customers', { exact: true })
  ).toBeVisible({ timeout: 180_000 });
}

const SCREENSHOT_DIR = process.env.SIDEBAR_LABELS_SCREENSHOT_DIR;

async function shoot(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  // Let a branch finish opening before the picture.
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/${name}.png`,
    fullPage: true,
  });
}

// A route still fetching as a test ends must not fail it.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    const phone = size.touch && size.width < 640;
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
      isMobile: phone,
    });

    test('groups labels by inbox, nests them, and stops at eight', async ({
      page,
    }) => {
      await open(page);
      const all = page.getByTestId('all-inboxes');
      const text = (name: string) => all.getByText(name, { exact: true });
      await expect(text('sam@acme.test')).toBeVisible();
      await expect(text('rivera@northwind.test')).toBeVisible();
      await expect(text('Board')).toBeVisible();
      await expect(text('Receipts')).toBeVisible();
      // Gmail's own labels never show; the ninth and the hidden one wait.
      await expect(text('INBOX')).toHaveCount(0);
      await expect(text('Travel')).toHaveCount(0);
      await expect(text('Archive')).toHaveCount(0);
      await shoot(page, `sidebar-${size.name}`);

      await text('2 more').click();
      await expect(text('Travel')).toBeVisible();
      await expect(text('Archive')).toBeVisible();
      await text('Show less').click();
      await expect(text('Travel')).toHaveCount(0);

      await all.getByRole('button', { name: 'Expand Customers' }).click();
      await text('Larkspur').click();
      await expect(
        all.getByRole('button', { name: 'Larkspur', exact: true })
      ).toHaveAttribute('aria-current', 'page');
      await shoot(page, `sidebar-open-${size.name}`);

      await text('rivera@northwind.test').click();
      await expect(text('Board')).toHaveCount(0);
    });

    test('shows the picked inbox alone, without its account row', async ({
      page,
    }) => {
      await open(page);
      const one = page.getByTestId('one-inbox');
      await expect(one.getByText('Customers', { exact: true })).toBeVisible();
      await expect(one.getByText('sam@acme.test', { exact: true })).toHaveCount(
        0
      );
      await expect(one.getByText('Board', { exact: true })).toHaveCount(0);
    });
  });
}
