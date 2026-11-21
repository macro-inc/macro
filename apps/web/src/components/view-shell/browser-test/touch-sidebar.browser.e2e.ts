import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

for (const width of [390, 1000]) {
  test(`the navigation sheet covers mobile chrome and owns taps at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(
      '/src/components/view-shell/browser-test/touch-sidebar.html?workspace&sheet-chrome'
    );
    const opener = page.getByRole('button', { name: 'Show sidebar' });
    const dock = page.getByTestId('background-dock');
    const points = [await opener.boundingBox(), await dock.boundingBox()];
    await opener.tap();
    const sheet = page.getByRole('dialog', { name: 'Sidebar' });
    await expect(sheet).toBeInViewport({ ratio: 1 });
    await expect(sheet).not.toHaveAttribute('data-transitioning');
    for (const bounds of points) {
      const point = {
        x: bounds!.x + bounds!.width / 2,
        y: bounds!.y + bounds!.height / 2,
      };
      expect(
        await sheet.evaluate(
          (element, point) =>
            element.contains(document.elementFromPoint(point.x, point.y)),
          point
        )
      ).toBe(true);
    }
    await sheet.getByRole('button', { name: 'Recent items' }).tap();
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(dock).toHaveAttribute('data-presses', '0');
    await dock.tap();
    await expect(dock).toHaveAttribute('data-presses', '1');
  });
}

test('Drive touch selections keep the routed file beside the list', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?drive-workspace'
  );
  await page.locator('[data-workspace-row="0"]').tap();
  await expect(page.getByTestId('drive-route')).toHaveText(
    'app/drive/drive-document'
  );
  await expect(page.getByTestId('drive-pane-count')).toHaveText('1');
  await expect(page.getByTestId('workspace-preview')).toContainText(
    'Preview 0'
  );
  await expect(page.getByTestId('workspace-list')).toBeVisible();
  const list = await page.locator('[data-view-shell-list]').boundingBox();
  const preview = await page.locator('[data-view-shell-detail]').boundingBox();
  expect(preview!.x).toBeGreaterThanOrEqual(list!.x + list!.width);
  await page.locator('[data-workspace-row="1"]').tap();
  await expect(page.getByTestId('drive-route')).toHaveText(
    'app/drive/drive-document'
  );
  await expect(page.getByTestId('workspace-preview')).toContainText(
    'Preview 1'
  );
  await expect(page.getByTestId('drive-pane-count')).toHaveText('1');
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
  await expect(navigation).toHaveCSS('width', '403px');
  const divider = page.locator('[data-resize-divider]');
  await expect(divider).toBeVisible();
  await expect(divider).toHaveCSS('border-left-width', '1px');
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
  await expect(divider).toHaveCount(0);
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
  await expect(divider).toBeVisible();
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

test('wide touch Chat docks the phone feed beside its conversation preview', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?channels'
  );
  const navigation = page.getByRole('complementary', {
    name: 'Chat navigation',
  });
  await expect(navigation).toBeVisible();
  const list = navigation.getByRole('tree', { name: 'Recent conversations' });
  await expect(list).toBeVisible();
  await navigation
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .tap();
  const preview = page.getByTestId('channel-preview');
  await expect(preview).toHaveText('Conversation 1 preview');
  const bounds = await page.evaluate(() => ({
    listRight: document
      .querySelector('[data-testid="channel-scroll"]')!
      .getBoundingClientRect().right,
    previewLeft: document
      .querySelector('[data-testid="channel-preview"]')!
      .getBoundingClientRect().left,
    rowTop: document
      .querySelector('[data-channel-row="0"]')!
      .getBoundingClientRect().top,
    headerBottom: document
      .querySelector('[data-mobile-list-header]')!
      .getBoundingClientRect().bottom,
  }));
  expect(bounds.previewLeft).toBeGreaterThanOrEqual(bounds.listRight);
  expect(bounds.rowTop).toBeGreaterThanOrEqual(bounds.headerBottom);
  await list.evaluate((element) => {
    element.scrollTop = 200;
  });
  const rowTop = await page
    .locator('[data-channel-row="0"]')
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(rowTop).toBeLessThan(bounds.headerBottom);
  await navigation.getByRole('button', { name: 'Hide navigation' }).tap();
  const expand = page.getByRole('button', { name: 'Show navigation' });
  await expect(expand).toBeVisible();
  await expand.tap();
  await expect(list).toBeVisible();
  await expect(preview).toHaveText('Conversation 1 preview');
});

test('wide touch conversation chrome floats inside its preview with the native side dock', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.route(
    '**/src/components/app/mobile/float-regions/FloatRegionHost.tsx*',
    async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const body = source.replace(
        /import \{ isNativeMobilePlatform \} from [^;]+;/,
        'const isNativeMobilePlatform = () => true;'
      );
      if (body === source)
        throw new Error('Native platform import was not found');
      await route.fulfill({ response, body });
    }
  );
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?channels'
  );
  await page.locator('[data-channel-row="0"]').tap();
  const header = page.locator('[data-channel-detail-header]');
  const main = page.locator('[data-view-shell-main]');
  const scroll = page.getByTestId('messages-scroll');
  const reply = page.getByRole('textbox', { name: 'Channel reply' });
  await expect(header).toBeVisible();
  await expect(
    header.getByRole('button', { name: 'Channel menu' })
  ).toBeVisible();
  await expect(
    header.getByRole('button', { name: 'Call', exact: true })
  ).toBeVisible();
  await reply.fill('Keep this conversation draft');
  const bounds = await main.boundingBox();
  const headerBounds = await header.boundingBox();
  const scrollBounds = await scroll.boundingBox();
  expect(headerBounds!.x).toBe(bounds!.x);
  expect(headerBounds!.width).toBe(bounds!.width);
  expect(headerBounds!.y).toBe(bounds!.y);
  expect(scrollBounds!.y).toBe(bounds!.y);
  expect(scrollBounds!.height).toBe(bounds!.height);
  const first = page.locator('[data-message="0"]');
  expect((await first.boundingBox())!.y).toBeGreaterThanOrEqual(
    headerBounds!.y + headerBounds!.height
  );
  expect(
    (await header.getByRole('button', { name: 'Channel menu' }).boundingBox())!
      .y
  ).toBeGreaterThanOrEqual(bounds!.y + 24 + 8);
  await expect(page.locator('[data-float-region="accessory"]')).toHaveCSS(
    'margin-left',
    `${bounds!.x}px`
  );
  await expect(
    page.locator('[data-float-region="accessory"]').locator('..')
  ).toHaveCSS('padding-bottom', '12px');
  await page
    .locator('[data-float-region="accessory"]')
    .evaluate(async (slot) => {
      await Promise.all(
        slot
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished)
      );
    });
  const replyBounds = await reply.boundingBox();
  expect(844 - replyBounds!.y - replyBounds!.height).toBe(12);
  await scroll.evaluate((element) => {
    element.scrollTop = 240;
  });
  expect((await first.boundingBox())!.y).toBeLessThan(
    headerBounds!.y + headerBounds!.height
  );
  await page.getByRole('button', { name: 'Hide navigation' }).tap();
  const expand = header.getByRole('button', { name: 'Show navigation' });
  await expect(expand).toBeVisible();
  await expand.tap();
  await expect(
    page.getByRole('button', { name: 'Hide navigation' })
  ).toBeVisible();
  await expect(reply).toHaveValue('Keep this conversation draft');
});

for (const { width, nested } of [
  { width: 390, nested: false },
  { width: 1000, nested: false },
  { width: 1000, nested: true },
]) {
  test(`floating list controls keep the fade off navigation at ${width}px (nested: ${nested})`, async ({
    page,
  }) => {
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
            // Wait for the pane to settle: mid-slide the chrome trails it by
            // a frame, within a pixel but not yet where the assertions hold.
            if (
              Math.abs(pane.left - floating.left) < 0.005 &&
              Math.abs(pane.width - floating.width) < 0.005
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
  const dividers = page.locator('[data-resize-divider]');
  await expect(dividers).toHaveCount(2);
  for (const divider of await dividers.all()) {
    await expect(divider).toBeVisible();
    await expect(divider).toHaveCSS('border-left-width', '1px');
  }
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

test('wide touch collections keep their list beside an empty or selected preview and open navigation in a sheet', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?workspace'
  );
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-top', '24px');
    document.documentElement.style.setProperty('--safe-bottom', '34px');
  });
  const list = page.getByTestId('workspace-list');
  const listFrame = page.locator('[data-view-shell-list]');
  const detail = page.locator('[data-view-shell-detail]');
  const expand = page.getByRole('button', { name: 'Show sidebar' });
  await expect(list).toBeVisible();
  await expect(detail).toContainText('Select an item to preview');
  expect((await listFrame.boundingBox())!.width).toBe(403);
  expect((await detail.boundingBox())!.x).toBe(404);
  await expect(
    page.getByRole('complementary', { name: 'Collection navigation' })
  ).toBeHidden();
  await page.locator('[data-workspace-row="0"]').tap();
  const draft = page.getByRole('textbox', { name: 'Preview draft' });
  await draft.fill('Keep this draft');
  const editor = await draft.elementHandle();
  const listNode = await list.elementHandle();
  const detailBox = await detail.boundingBox();
  const chrome = detail.locator('[data-view-shell-top-bar]');
  expect((await chrome.boundingBox())!.y).toBe(0);
  expect(
    await chrome.evaluate((element) => getComputedStyle(element).paddingTop)
  ).toBe('32px');
  await list.evaluate((element) => {
    element.scrollTop = 200;
  });
  await expand.tap();
  const sheet = page.getByRole('dialog', { name: 'Sidebar' });
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).not.toHaveAttribute('data-transitioning');
  await expect(sheet).toHaveAttribute('data-side', 'left');
  expect(await sheet.boundingBox()).toEqual(await listFrame.boundingBox());
  await expect(sheet.locator('[data-drawer-scroll-body]')).toHaveCSS(
    'padding-bottom',
    '34px'
  );
  const footer = await sheet
    .getByRole('button', { name: 'Sidebar footer' })
    .boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(844 - 34);
  expect(
    (await sheet.getByRole('heading', { name: 'Collection' }).boundingBox())!.y
  ).toBeGreaterThanOrEqual(24);
  expect(
    (await sheet.getByRole('button', { name: 'Hide sidebar' }).boundingBox())!.y
  ).toBeGreaterThanOrEqual(24);
  expect(await detail.boundingBox()).toEqual(detailBox);
  expect(
    await list.evaluate((element, original) => element === original, listNode)
  ).toBe(true);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(200);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(expand).toBeFocused();
  expect(
    await draft.evaluate((element, original) => element === original, editor)
  ).toBe(true);
  await expect(draft).toHaveValue('Keep this draft');
  const reply = page.getByRole('textbox', { name: 'Collection reply' });
  await expect(reply).toBeVisible();
  await expect(page.locator('[data-float-region="accessory"]')).toHaveCSS(
    'margin-left',
    '404px'
  );
  await expand.tap();
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).not.toHaveAttribute('data-transitioning');
  await sheet.getByRole('button', { name: 'Recent items' }).tap();
  await expect(sheet).toBeHidden();
  await expect(detail).toContainText('Select an item to preview');
  await expect(listFrame).toContainText('recent');
  expect((await listFrame.boundingBox())!.width).toBe(403);
});

test('folding a collection preserves the mounted detail and its draft', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?workspace'
  );
  await page.locator('[data-workspace-row="0"]').tap();
  const draft = page.getByRole('textbox', { name: 'Preview draft' });
  await draft.fill('Draft through a fold');
  const editor = await draft.elementHandle();
  await page.setViewportSize({ width: 700, height: 844 });
  await expect(page.getByTestId('workspace-list')).toBeHidden();
  await expect(draft).toBeVisible();
  expect(
    await draft.evaluate((element, original) => element === original, editor)
  ).toBe(true);
  await expect(draft).toHaveValue('Draft through a fold');
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect(page.getByTestId('workspace-list')).toBeVisible();
  expect(
    await draft.evaluate((element, original) => element === original, editor)
  ).toBe(true);
  await expect(draft).toHaveValue('Draft through a fold');
  await expect(
    page.getByRole('button', { name: 'Show sidebar' })
  ).toBeVisible();
});

test('Back and a left-edge swipe return a folded detail to its list', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?workspace'
  );
  const list = page.getByTestId('workspace-list');
  const preview = page.getByTestId('workspace-preview');
  const back = preview.getByRole('button', { name: 'Back', exact: true });
  const select = () => list.locator('[data-workspace-row="0"]').tap();
  const narrow = () => page.setViewportSize({ width: 390, height: 844 });
  const wide = () => page.setViewportSize({ width: 1000, height: 844 });

  await select();
  await expect(preview).toBeVisible();
  await expect(back).toBeHidden();
  await narrow();
  await expect(list).toBeHidden();
  await back.tap();
  await expect(list).toBeVisible();
  await expect(preview).toBeHidden();

  await wide();
  await select();
  const originalList = await list.elementHandle();
  await narrow();
  await expect(back).toBeVisible();

  const touch = await page.context().newCDPSession(page);
  const swipe = async (end: { x: number; y: number }) => {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 4, y: 160 }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [end],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  };
  await swipe({ x: 12, y: 340 });
  await expect(preview).toBeVisible();

  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 4, y: 160 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 104, y: 160 }],
  });
  await expect(list).toBeVisible();
  expect((await preview.boundingBox())!.x).toBeCloseTo(100);
  await expect(page.locator('[data-view-shell-list]')).toHaveAttribute('inert');
  expect(
    await list.evaluate(
      (element, original) => element === original,
      originalList
    )
  ).toBe(true);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  await expect(list).toBeHidden();
  expect((await preview.boundingBox())!.x).toBeCloseTo(0);

  await swipe({ x: 240, y: 160 });
  await expect(list).toBeVisible();
  await expect(preview).toBeHidden();
});

test('custom reading panes retain a resized wide touch list across container resizing', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1100, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?reader-workspace'
  );
  const main = page.locator('[data-view-shell-main]');
  await expect(main).toHaveCSS('width', '403px');
  const draft = page.getByRole('textbox', { name: 'Reader draft' });
  await draft.fill('Keep the reader draft');
  const editor = await draft.elementHandle();
  const divider = page.getByRole('separator', { name: 'resize at 0' });
  await divider.press('ArrowRight');
  await divider.press('ArrowRight');
  await expect(main).toHaveCSS('width', '443px');
  await page.setViewportSize({ width: 1200, height: 844 });
  await expect(main).toHaveCSS('width', '443px');
  expect(
    await draft.evaluate((element, original) => element === original, editor)
  ).toBe(true);
  await expect(draft).toHaveValue('Keep the reader draft');
  await page.setViewportSize({ width: 700, height: 844 });
  await page.setViewportSize({ width: 1100, height: 844 });
  await expect(main).toHaveCSS('width', '443px');
});

test('the left navigation sheet covers an offset list and follows its viewport height', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1100, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?workspace&offset'
  );
  const listFrame = page.locator('[data-view-shell-list]');
  await page.getByRole('button', { name: 'Show sidebar' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Sidebar' });
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).not.toHaveAttribute('data-transitioning');
  await expect(sheet).toHaveAttribute('data-side', 'left');
  expect((await sheet.boundingBox())!.x).toBe(64);
  expect(await sheet.boundingBox()).toEqual(await listFrame.boundingBox());
  await page.setViewportSize({ width: 1200, height: 780 });
  await expect(sheet).toHaveCSS('height', '780px');
  expect(await sheet.boundingBox()).toEqual(await listFrame.boundingBox());
});
