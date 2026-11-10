import { expect, type Page, test } from '@playwright/test';

/**
 * Opens the real Notifications view over the fixture's feed. `mode` is the
 * fixture's `?mode=`. Returns the page's uncaught errors.
 */
async function mount(page: Page, mode?: 'empty-noise' | 'no-lanes') {
  const origin = test.info().project.use.baseURL;
  const unexpected: string[] = [];
  page.on('pageerror', (error) => unexpected.push(error.message));
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      await route.abort();
      return;
    }

    // Serve Vite assets through the runner as well. Host interface changes
    // must not abort Chromium module loads before the test starts.
    await route.fulfill({ response: await route.fetch() });
  });

  const query = mode ? `?mode=${mode}` : '';
  await page.goto(`/tests/functional/notifications-inbox/index.html${query}`);

  return unexpected;
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the Noise tab lists what stacks captured, apart from Signal', async ({
    page,
  }) => {
    const unexpected = await mount(page);
    const lanes = page.getByRole('radiogroup', { name: 'Lane' });

    await expect(lanes.getByRole('radio', { name: 'Signal' })).toBeChecked();
    await expect(lanes.getByRole('radio', { name: 'Noise' })).not.toBeChecked();
    await expect(
      page.getByRole('row', { name: /Dana Whitfield/ })
    ).toBeVisible();
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toHaveCount(0);

    await lanes.getByText('Noise', { exact: true }).click();

    await expect(lanes.getByRole('radio', { name: 'Noise' })).toBeChecked();
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Lunch Bot/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Dana Whitfield/ })).toHaveCount(
      0
    );

    await lanes.getByText('Signal', { exact: true }).click();

    await expect(lanes.getByRole('radio', { name: 'Signal' })).toBeChecked();
    await expect(
      page.getByRole('row', { name: /Dana Whitfield/ })
    ).toBeVisible();
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toHaveCount(0);
    expect(unexpected).toEqual([]);
  });

  test('the Unread toggle narrows Noise to unread rows', async ({ page }) => {
    const unexpected = await mount(page);
    const lanes = page.getByRole('radiogroup', { name: 'Lane' });
    const unread = page.getByRole('button', { name: 'Unread', exact: true });
    await lanes.getByText('Noise', { exact: true }).click();
    await expect(unread).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('row', { name: /Lunch Bot/ })).toBeVisible();

    await unread.click();

    await expect(unread).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Lunch Bot/ })).toHaveCount(0);

    await unread.click();

    await expect(unread).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Lunch Bot/ })).toBeVisible();
    expect(unexpected).toEqual([]);
  });

  test('an empty Noise lane points to the stack settings', async ({ page }) => {
    const unexpected = await mount(page, 'empty-noise');
    const settingsOpened = page.getByRole('status', {
      name: 'Settings opened',
    });
    await page
      .getByRole('radiogroup', { name: 'Lane' })
      .getByText('Noise', { exact: true })
      .click();

    await expect(
      page.getByRole('heading', { name: 'Nothing in Noise' })
    ).toBeVisible();
    await expect(settingsOpened).toHaveText('0');

    await page.getByRole('button', { name: 'Manage stacks' }).click();

    await expect(settingsOpened).toHaveText('1');
    expect(unexpected).toEqual([]);
  });

  test('without lanes there is no Noise tab', async ({ page }) => {
    const unexpected = await mount(page, 'no-lanes');
    const status = page.getByRole('radiogroup', { name: 'Status' });

    await expect(status.getByRole('radio', { name: 'All' })).toBeChecked();
    await expect(status.getByRole('radio', { name: 'Unread' })).toBeVisible();
    await expect(
      page.getByRole('row', { name: /Dana Whitfield/ })
    ).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Lane' })).toHaveCount(0);
    await expect(page.getByText('Noise', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Unread', exact: true })
    ).toHaveCount(0);
    expect(unexpected).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('the lane pills switch between Signal and Noise', async ({ page }) => {
    const unexpected = await mount(page);
    const signal = page.getByRole('button', { name: 'Signal', exact: true });
    const noise = page.getByRole('button', { name: 'Noise', exact: true });

    await expect(signal).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('row', { name: /Dana Whitfield/ })
    ).toBeVisible();
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toHaveCount(0);

    await noise.tap();

    await expect(noise).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Lunch Bot/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Dana Whitfield/ })).toHaveCount(
      0
    );

    await signal.tap();

    await expect(signal).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('row', { name: /Dana Whitfield/ })
    ).toBeVisible();
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toHaveCount(0);
    expect(unexpected).toEqual([]);
  });

  test('Unread only in the filter drawer narrows Noise to unread rows', async ({
    page,
  }) => {
    const unexpected = await mount(page);
    await page.getByRole('button', { name: 'Noise', exact: true }).tap();
    await expect(page.getByRole('row', { name: /Lunch Bot/ })).toBeVisible();

    await page.getByRole('button', { name: 'Filter notifications' }).tap();
    const filters = page.getByRole('dialog', { name: 'Notification filters' });
    const unreadOnly = filters.getByRole('switch', { name: 'Unread only' });
    await expect(unreadOnly).not.toBeChecked();
    await filters.getByText('Unread only', { exact: true }).tap();
    await expect(unreadOnly).toBeChecked();
    await filters.getByRole('button', { name: 'Close filters' }).tap();

    await expect(filters).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Deploy Bot/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Lunch Bot/ })).toHaveCount(0);
    expect(unexpected).toEqual([]);
  });

  test('without lanes there is no Noise pill', async ({ page }) => {
    const unexpected = await mount(page, 'no-lanes');

    await expect(
      page.getByRole('button', { name: 'All', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: 'Unread', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: /Dana Whitfield/ })
    ).toBeVisible();
    await expect(page.getByText('Noise', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Filter notifications' }).tap();

    const filters = page.getByRole('dialog', { name: 'Notification filters' });
    await expect(
      filters.getByRole('checkbox', { name: 'Mentions' })
    ).toBeVisible();
    await expect(filters.getByRole('switch')).toHaveCount(0);
    expect(unexpected).toEqual([]);
  });
});
