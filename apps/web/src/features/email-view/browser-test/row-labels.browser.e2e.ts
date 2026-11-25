import { expect, type Page, test } from '@playwright/test';

// Labels follow tags: wide rows show them, narrow and phone rows don't.
const SIZES = [
  { name: 'wide', width: 1100, height: 700, touch: false, shows: true },
  { name: 'stacked', width: 440, height: 800, touch: false, shows: false },
  { name: 'tablet', width: 820, height: 1180, touch: true, shows: true },
  { name: 'phone', width: 390, height: 844, touch: true, shows: false },
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
  await page.goto('/src/features/email-view/browser-test/row-labels.html');
  await expect(page.getByTestId('row-hidden')).toBeVisible({
    timeout: 180_000,
  });
}

const SCREENSHOT_DIR = process.env.ROW_LABELS_SCREENSHOT_DIR;

async function shoot(page: Page, name: string) {
  if (SCREENSHOT_DIR)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
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

    test(
      size.shows ? 'rows show their labels' : 'rows show no labels',
      async ({ page }) => {
        await open(page);
        const two = page.getByTestId('row-two');
        await shoot(page, `rows-${size.name}`);
        if (!size.shows) {
          await expect(two.getByText('Larkspur', { exact: true })).toHaveCount(
            0
          );
          await expect(two.getByText('Orders', { exact: true })).toHaveCount(0);
          return;
        }
        // A nested label shows its own name, never Gmail's system labels.
        await expect(two.getByText('Larkspur', { exact: true })).toBeVisible();
        await expect(two.getByText('Orders', { exact: true })).toBeVisible();
        await expect(two.getByText('INBOX', { exact: true })).toHaveCount(0);

        // Three fit; the fourth folds into the count.
        const four = page.getByTestId('row-four');
        for (const name of ['Orders', 'Escalations', 'Billing']) {
          await expect(four.getByText(name, { exact: true })).toBeVisible();
        }
        await expect(four.getByText('+1', { exact: true })).toBeVisible();
        // Folded labels are read to screen readers only.
        await expect(four.getByText('Customers', { exact: true })).toHaveClass(
          /sr-only/
        );

        // Labels Gmail hides from the message list stay off the row.
        const hidden = page.getByTestId('row-hidden');
        await expect(hidden.getByText('Receipts', { exact: true })).toHaveCount(
          0
        );
      }
    );

    test('a label shows its whole name on hover', async ({ page }) => {
      test.skip(!size.shows || size.touch);
      await open(page);
      // Screen readers hear the whole name; the screen shows it on hover.
      const shown = (text: string) =>
        page
          .getByText(text, { exact: true })
          .and(page.locator(':not(.sr-only)'));
      await expect(
        page
          .getByTestId('row-two')
          .getByText('Customers / Larkspur', { exact: true })
      ).toHaveClass(/sr-only/);
      await expect(shown('Customers / Larkspur')).toHaveCount(0);
      await page
        .getByTestId('row-two')
        .getByText('Larkspur', { exact: true })
        .hover();
      await expect(shown('Customers / Larkspur')).toBeVisible();
      await shoot(page, `hover-${size.name}`);
      // Its card opens over the rows below; let it close first.
      await page.mouse.move(10, size.height - 10);
      await expect(shown('Customers / Larkspur')).toHaveCount(0);
      await page
        .getByTestId('row-four')
        .getByText('+1', { exact: true })
        .hover();
      await expect(shown('Customers')).toBeVisible();
    });
  });
}
