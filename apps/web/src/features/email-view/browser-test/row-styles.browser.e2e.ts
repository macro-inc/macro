import { expect, type Locator, type Page, test } from '@playwright/test';

// Phones always show Minimalist rows, whatever the setting says.
const SIZES = [
  { name: 'wide', width: 1100, height: 700, touch: false, wide: true },
  { name: 'stacked', width: 440, height: 800, touch: false, wide: false },
  { name: 'tablet', width: 820, height: 1180, touch: true, wide: true },
  { name: 'phone', width: 390, height: 844, touch: true, wide: false },
];

async function open(page: Page, style: string, theme = 'dark') {
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
  await page.goto(
    `/src/features/email-view/browser-test/row-styles.html?style=${style}&theme=${theme}`
  );
  await expect(page.getByTestId('row-read-4')).toBeVisible({
    timeout: 180_000,
  });
}

const fontWeight = (locator: Locator) =>
  locator.evaluate((node) => getComputedStyle(node).fontWeight);

/** Whether the row shows its checkbox outline without a hover. */
const showsCheckbox = (row: Locator) =>
  row.evaluate((node) => {
    const box = node.querySelector('[role="checkbox"] span');
    if (!box || box.getClientRects().length === 0) return false;
    return getComputedStyle(box).opacity === '1';
  });

/** The row's own surface: the entity root inside the test row. */
const rowSurface = (page: Page, id: string) =>
  page.getByTestId(`row-${id}`).locator('.soup-list-entity');

async function weights(
  page: Page,
  id: string,
  sender: string,
  subject: string
) {
  const row = page.getByTestId(`row-${id}`);
  return {
    sender: await fontWeight(row.getByText(sender, { exact: true })),
    subject: await fontWeight(row.getByText(subject, { exact: true })),
    date: await fontWeight(row.getByText('Nov 3', { exact: true })),
    preview: await fontWeight(row.getByText(/^Here is the latest/)),
  };
}

// A route still fetching as a test ends must not fail it.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    // The `mobile:` variant: touch and under 640px.
    const phone = size.touch && size.width < 640;
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
      isMobile: phone,
    });

    const minimalistStyles = phone ? ['minimalist', 'classic'] : ['minimalist'];
    for (const style of minimalistStyles) {
      test(`${style} setting: unread mail has a dot, the checkbox is hidden`, async ({
        page,
      }) => {
        await open(page, style);
        const unread = page.getByTestId('row-unread-1');
        const read = page.getByTestId('row-read-1');

        await expect(unread.locator('.bg-accent.rounded-full')).toBeVisible();
        expect(await showsCheckbox(unread)).toBe(false);
        // No surface of its own: unread and read rows share the list's.
        await expect(rowSurface(page, 'unread-1')).toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)'
        );
        await expect(read.locator('.bg-accent.rounded-full')).toHaveCSS(
          'opacity',
          '0'
        );
      });
    }

    for (const theme of ['dark', 'light']) {
      test(`Classic lifts unread rows and keeps the checkbox (${theme})`, async ({
        page,
      }) => {
        test.skip(phone);
        await open(page, 'classic', theme);
        const unread = page.getByTestId('row-unread-1');
        const read = page.getByTestId('row-read-1');

        // No unread dot; every row shows its checkbox outline instead.
        await expect(page.locator('.bg-accent.rounded-full')).toHaveCount(0);
        for (const row of [unread, read]) {
          expect(await showsCheckbox(row)).toBe(true);
        }

        // The unread row is lifted onto a surface; the read row is not.
        const unreadFill = await rowSurface(page, 'unread-1').evaluate(
          (node) => getComputedStyle(node).backgroundColor
        );
        expect(unreadFill).not.toBe('rgba(0, 0, 0, 0)');
        await expect(rowSurface(page, 'read-1')).toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)'
        );
        // Lifting reserves no extra room: both rows are as tall.
        const height = async (id: string) =>
          (await rowSurface(page, id).boundingBox())?.height;
        expect(await height('unread-1')).toBe(await height('read-1'));

        // Sender, subject and date are bolder while unread; the preview isn't.
        const unreadWeights = await weights(
          page,
          'unread-1',
          'Avery Stone',
          'Contract redlines for Friday'
        );
        const readWeights = await weights(
          page,
          'read-1',
          'Casey Moore',
          'Notes from the offsite'
        );
        expect(unreadWeights.sender).toBe('600');
        expect(unreadWeights.subject).toBe('600');
        expect(unreadWeights.date).toBe('600');
        expect(readWeights.sender).toBe('400');
        expect(readWeights.subject).toBe('400');
        expect(readWeights.date).toBe('400');
        expect(unreadWeights.preview).toBe(readWeights.preview);
      });
    }

    test('Classic draws a faint line under each read row', async ({ page }) => {
      test.skip(phone);
      await open(page, 'classic');
      const lineUnder = (id: string) =>
        rowSurface(page, id).evaluate((root, wide) => {
          if (wide) {
            const after = getComputedStyle(root, '::after');
            return after.content === 'none' ? null : after.height;
          }
          const divider = root.querySelector('.bg-edge-divider');
          return divider ? `${divider.getBoundingClientRect().height}px` : null;
        }, size.wide);

      expect(await lineUnder('read-2')).toBe('1px');
      expect(await lineUnder('read-3')).toBe('1px');
      // A lifted row's own edge separates it.
      expect(await lineUnder('unread-1')).toBeNull();
    });

    test('Classic checkboxes select without opening; rows still open', async ({
      page,
    }) => {
      test.skip(phone);
      await open(page, 'classic');
      const main = page.getByRole('main');
      const checkbox = page.getByTestId('row-read-1').getByRole('checkbox');

      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'true');
      await expect(main).toHaveAttribute('data-opened', '');

      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'false');

      await page
        .getByTestId('row-unread-2')
        .getByText('Can we move the review?', { exact: true })
        .click();
      await expect(main).toHaveAttribute('data-opened', 'unread-2');
    });
  });
}
