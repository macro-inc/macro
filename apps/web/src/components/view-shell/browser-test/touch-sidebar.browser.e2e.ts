import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('collapses beside the view title and reopens before touch filters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/src/components/view-shell/browser-test/touch-sidebar.html');
  const navigation = page.getByRole('complementary', {
    name: 'Workspace navigation',
  });
  const collapse = page.getByRole('button', { name: 'Hide navigation' });
  await expect(navigation).toBeVisible();
  await expect(navigation).toHaveCSS('width', '388px');
  await expect(collapse).toBeVisible();
  const title = await navigation
    .getByRole('heading', { name: 'Drive' })
    .boundingBox();
  const button = await collapse.boundingBox();
  expect(button!.x).toBeGreaterThan(title!.x + title!.width);
  expect(
    Math.abs(button!.y + button!.height / 2 - title!.y - title!.height / 2)
  ).toBeLessThan(1);

  await collapse.tap();
  const expand = page.getByRole('button', { name: 'Show navigation' });
  await expect(expand).toBeVisible();
  const controls = await page.evaluate(() => {
    const expand = document.querySelector<HTMLButtonElement>(
      '[data-view-sidebar-toggle="expand"]'
    );
    const filters = document.querySelector<HTMLButtonElement>(
      '[aria-label="Filters"]'
    );
    if (!expand || !filters) throw new Error('Touch controls are missing');
    // Measure together while the sidebar's close animation moves the pane.
    return {
      expandRight: expand.getBoundingClientRect().right,
      filterLeft: filters.getBoundingClientRect().left,
    };
  });
  expect(controls.expandRight).toBeLessThan(controls.filterLeft);
  await expand.tap();
  await expect(collapse).toBeVisible();
  await expect(collapse).toBeFocused();
  await page.getByRole('button', { name: 'Recent', exact: true }).tap();
  await expect(page.getByText('Selected: recent')).toBeVisible();

  await collapse.tap();
  await page.reload();
  await expect(expand).toBeVisible();
});

test('uses the same width breakpoint on touch and retains the wide preference after folding', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/src/components/view-shell/browser-test/touch-sidebar.html');
  const expand = page.getByRole('button', { name: 'Show navigation' });
  const collapse = page.getByRole('button', { name: 'Hide navigation' });
  await expect(collapse).toBeVisible();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(expand).toBeVisible();
  await expand.tap();
  await expect(
    page.getByRole('button', { name: 'Close navigation backdrop' })
  ).toBeVisible();
  await collapse.tap();
  await expect(expand).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(collapse).toBeVisible();
  await collapse.tap();
  await page.setViewportSize({ width: 600, height: 800 });
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(expand).toBeVisible();
});

test('phone Chat has no navigation row or extra gap and wide Chat retains sidebar controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?channels'
  );
  const expand = page.getByRole('button', { name: 'Show navigation' });
  await expect(expand).toBeHidden();
  const scroller = page.getByTestId('channel-scroll');
  const shell = page.locator('[data-view-shell-main]');
  const scrollBox = await scroller.boundingBox();
  const shellBox = await shell.boundingBox();
  expect(scrollBox!.y).toBe(shellBox!.y);
  expect(scrollBox!.height).toBe(shellBox!.height);
  const first = scroller.locator('[data-channel-row="0"]');
  expect((await first.boundingBox())!.y).toBe(scrollBox!.y);
  await scroller.evaluate((element) => {
    element.scrollTop = 80;
  });
  expect((await first.boundingBox())!.y).toBeLessThan(scrollBox!.y);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.getByRole('button', { name: 'Hide navigation' }).tap();
  await expect(expand).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(expand).toBeHidden();
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect(expand).toBeVisible();
});

for (const { width, nested } of [
  { width: 390, nested: false },
  { width: 1000, nested: false },
  { width: 1000, nested: true },
]) {
  test(`floating list controls keep the fade off navigation at ${width}px (nested: ${nested})`, async ({
    page,
  }) => {
    // Exercise the real iOS fade in this browser without enabling native bridges.
    await page.route(
      '**/src/components/app/mobile/MobileEdgeFade.tsx*',
      async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const body = source.replace(
          /import \{ isPlatform \} from [^;]+;/,
          "const isPlatform = (target) => target === 'ios';"
        );
        if (body === source)
          throw new Error('Fade platform import was not found');
        await route.fulfill({ response, body });
      }
    );
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(
      `/src/components/view-shell/browser-test/touch-sidebar.html?list${nested ? '&nested' : ''}`
    );
    const scroller = page.getByTestId('collection-scroll');
    await expect(scroller).toBeVisible();
    const main = page.locator('[data-view-shell-main]');
    const header = page.locator('[data-mobile-list-header]').last();
    const first = page.locator('[data-collection-row="0"]');
    const fade = page.locator('[data-mobile-top-edge-fade]').last();
    await expect(fade).toBeVisible();
    const bounds = await main.boundingBox();
    expect((await scroller.boundingBox())!.y).toBe(bounds!.y);
    expect((await scroller.boundingBox())!.height).toBe(bounds!.height);
    const fadeBox = await fade.boundingBox();
    expect(fadeBox!.x).toBe(bounds!.x);
    expect(fadeBox!.width).toBe(bounds!.width);
    expect((await first.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await header.boundingBox())!.y + (await header.boundingBox())!.height
    );
    const more = page.getByRole('button', { name: 'More controls' });
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.locator('[data-extra-controls]')).toBeVisible();
    await scroller.evaluate(async (element) => {
      const spacer = element.firstElementChild;
      const header = element
        .closest('[data-mobile-list-layout]')
        ?.querySelector('[data-mobile-list-header]');
      const first = element.querySelector('[data-collection-row="0"]');
      if (!spacer || !header || !first)
        throw new Error('List geometry is missing');
      // Header height and scroll clearance settle through ResizeObserver delivery.
      await new Promise<void>((resolve) => {
        const observer = new ResizeObserver(() => {
          if (
            first.getBoundingClientRect().top >=
            header.getBoundingClientRect().bottom
          ) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(spacer);
      });
    });
    expect((await first.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await header.boundingBox())!.y + (await header.boundingBox())!.height
    );
    await scroller.evaluate((element) => {
      element.scrollTop = 180;
    });
    expect((await first.boundingBox())!.y).toBeLessThan(
      (await header.boundingBox())!.y
    );
    await page.getByRole('button', { name: 'Recent', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Recent', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
  });
}

for (const width of [390, 720]) {
  test(`Notifications stays full frame on touch at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(
      '/src/components/view-shell/browser-test/touch-sidebar.html?home'
    );
    await page.waitForSelector('[data-view-shell]', { timeout: 60000 });
    const scroller = page.getByTestId('notifications-scroll');
    await expect(scroller).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Signal', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'New chat' })).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Show navigation' })
    ).toBeHidden();
    await expect(page.getByRole('complementary')).toHaveCount(0);
    const bounds = await page.evaluate(() => {
      const main = document
        .querySelector('[data-view-shell-main]')!
        .getBoundingClientRect();
      const scroll = document
        .querySelector('[data-testid="notifications-scroll"]')!
        .getBoundingClientRect();
      const row = document
        .querySelector('[data-notification-row="0"]')!
        .getBoundingClientRect();
      const header = document
        .querySelector('[data-mobile-list-header]')!
        .getBoundingClientRect();
      return {
        main: { x: main.x, y: main.y, width: main.width, height: main.height },
        scroll: {
          x: scroll.x,
          y: scroll.y,
          width: scroll.width,
          height: scroll.height,
        },
        rowTop: row.top,
        headerBottom: header.bottom,
      };
    });
    expect(bounds.scroll).toEqual(bounds.main);
    expect(bounds.rowTop).toBeGreaterThanOrEqual(bounds.headerBottom);
    await page.getByRole('button', { name: 'Noise', exact: true }).tap();
    await expect(page.getByText('Selected: noise')).toHaveCount(1);
    await scroller.evaluate((element) => {
      element.scrollTop = 200;
    });
    const rowTop = await page
      .locator('[data-notification-row="0"]')
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(rowTop).toBeLessThan(bounds.headerBottom);
  });
}

test('wide Notifications opens beside its feed and preserves collapse across folding', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?home'
  );
  await page.waitForSelector('[data-view-shell]', { timeout: 60000 });
  const collapse = page.getByRole('button', { name: 'Hide navigation' });
  const expand = page.getByRole('button', { name: 'Show navigation' });
  const list = page.getByTestId('notifications-scroll');
  const preview = page.getByTestId('notification-preview');
  await expect(collapse).toBeVisible();
  await page.getByRole('button', { name: 'Notification 1', exact: true }).tap();
  await expect(preview).toHaveText('Preview 1');
  const bounds = await page.evaluate(() => ({
    listRight: document
      .querySelector('[data-testid="notifications-scroll"]')!
      .getBoundingClientRect().right,
    previewLeft: document
      .querySelector('[data-testid="notification-preview"]')!
      .getBoundingClientRect().left,
  }));
  expect(bounds.previewLeft).toBeGreaterThanOrEqual(bounds.listRight);
  await expect(page.getByRole('button', { name: 'New chat' })).toBeHidden();
  await collapse.tap();
  await expect(expand).toBeVisible();
  await page.setViewportSize({ width: 600, height: 844 });
  await expect(list).toBeVisible();
  await expect(expand).toBeHidden();
  await expect(preview).toBeHidden();
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect(expand).toBeVisible();
  await expand.tap();
  await expect(collapse).toBeVisible();
  await expect(list).toBeVisible();
  await expect(preview).toHaveText('Preview 1');
});

for (const edge of ['bottom', 'right']) {
  test(`floating preview chrome follows its pane with ${edge} navigation`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1000, height: 844 });
    await page.goto(
      `/src/components/view-shell/browser-test/touch-sidebar.html?chrome&edge=${edge}`
    );
    await page.waitForSelector('[data-view-shell]', { timeout: 60000 });
    const reply = page.getByRole('textbox', { name: 'Preview reply' });
    await reply.fill('Keep this draft');
    const originalReply = await reply.elementHandle();
    const checkBounds = async () => {
      const bounds = await page.evaluate(async () => {
        const main = document.querySelector('[data-view-shell-main]')!;
        const chrome = document.querySelector(
          '[data-float-region="accessory"]'
        )!;
        await new Promise<void>((resolve) => {
          const resized = new ResizeObserver(check);
          const moved = new MutationObserver(check);
          function check() {
            const pane = main.getBoundingClientRect();
            const floating = chrome.getBoundingClientRect();
            if (
              Math.abs(pane.left - floating.left) < 1 &&
              Math.abs(pane.width - floating.width) < 1
            ) {
              resized.disconnect();
              moved.disconnect();
              resolve();
            }
          }
          resized.observe(main);
          resized.observe(chrome);
          moved.observe(chrome, {
            attributes: true,
            attributeFilter: ['style'],
          });
          check();
        });
        const pane = main.getBoundingClientRect();
        const floating = chrome.getBoundingClientRect();
        return {
          paneLeft: pane.left,
          paneWidth: pane.width,
          chromeLeft: floating.left,
          chromeWidth: floating.width,
        };
      });
      expect(bounds.chromeLeft).toBeCloseTo(bounds.paneLeft);
      expect(bounds.chromeWidth).toBeCloseTo(bounds.paneWidth);
      await expect(reply).toHaveValue('Keep this draft');
      expect(
        await reply.evaluate(
          (element, original) => element === original,
          originalReply
        )
      ).toBe(true);
    };
    await checkBounds();
    await page.locator('[data-view-shell-main]').evaluate((element) => {
      element.style.transform = 'translateX(-20px)';
    });
    await checkBounds();
    await page.locator('[data-view-shell-main]').evaluate((element) => {
      element.style.transform = '';
    });
    await checkBounds();
    await page.getByRole('button', { name: 'Hide navigation' }).tap();
    await checkBounds();
    await page.getByRole('button', { name: 'Show navigation' }).tap();
    await checkBounds();
    await page.setViewportSize({ width: 600, height: 844 });
    await checkBounds();
    await expect(
      page.getByRole('button', { name: 'App navigation' })
    ).toBeVisible();
  });
}

test('floating chrome hands ownership back when a detail closes', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1200, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?chrome'
  );
  await page.waitForSelector('[data-view-shell]', { timeout: 60000 });
  const mainReply = page.getByRole('textbox', { name: 'Preview reply' });
  await mainReply.fill('Main draft');
  await page.getByRole('button', { name: 'Open detail' }).tap();
  const detailReply = page.getByRole('textbox', { name: 'Detail reply' });
  await detailReply.fill('Detail draft');
  const detail = page.locator('[data-view-shell-detail-placement="inline"]');
  await expect(detail).toBeVisible();
  const detailWidth = await detail.evaluate(
    (element) => element.getBoundingClientRect().width
  );
  await expect(page.locator('[data-float-region="accessory"]')).toHaveCSS(
    'width',
    `${detailWidth}px`
  );
  const bounds = await page.evaluate(() => ({
    detail: document
      .querySelector('[data-view-shell-detail]')!
      .getBoundingClientRect().left,
    chrome: document
      .querySelector('[data-float-region="accessory"]')!
      .getBoundingClientRect().left,
  }));
  expect(bounds.chrome).toBeCloseTo(bounds.detail);
  await page.getByRole('button', { name: 'Close detail' }).tap();
  await expect(detailReply).toBeHidden();
  await expect(mainReply).toHaveValue('Main draft');
  const width = await page
    .locator('[data-view-shell-main]')
    .evaluate((element) => element.getBoundingClientRect().width);
  await expect(page.locator('[data-float-region="accessory"]')).toHaveCSS(
    'width',
    `${width}px`
  );
});
