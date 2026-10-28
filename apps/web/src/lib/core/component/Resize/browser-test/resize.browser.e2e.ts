import { expect, test } from '@playwright/test';

test('draft edits still expand and compact on phone and tablet touch viewports', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    const composer = page.locator('.composer');
    const editor = page.locator('[contenteditable="true"]');
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await editor.tap();
      await editor.fill('Hi');
      await expect(composer).toHaveAttribute('data-composer-compact', 'true');
      await editor.fill(
        'A longer draft that wraps beside the controls and needs another line.'
      );
      await expect(composer).toHaveAttribute('data-composer-compact', 'false');
      await expect(editor).toBeFocused();
    }
  } finally {
    await context.close();
  }
});

test('dragging splits and resizing the window reflows a composer without observer loops and retains scrolling', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  // Chromium reports observer delivery failures through window.error, rather
  // than pageerror. Keep that event visible to this regression.
  await page.exposeFunction('recordResizeError', (message: string) =>
    errors.push(message)
  );
  await page.addInitScript(() => {
    addEventListener('error', (event) => {
      Reflect.get(window, 'recordResizeError')(event.message);
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const composer = page.locator('.composer');
  await expect(composer).toHaveAttribute('data-composer-compact', 'true');
  const handle = page.getByRole('separator');
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(250, 300, { steps: 30 });
  await page.mouse.up();
  await expect(composer).toHaveAttribute('data-composer-compact', 'false');
  const scroller = page.getByTestId('scroller');
  await scroller.hover();
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const narrowBounds = await handle.boundingBox();
  expect(narrowBounds).not.toBeNull();
  await page.mouse.move(narrowBounds!.x + narrowBounds!.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(1000, 300, { steps: 30 });
  await page.mouse.up();
  await expect(composer).toHaveAttribute('data-composer-compact', 'true');
  for (const [width, compact] of [
    [700, false],
    [1600, true],
    [800, false],
    [1500, true],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await expect(composer).toHaveAttribute(
      'data-composer-compact',
      String(compact)
    );
    // Let the next observer delivery complete before checking recorded errors.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
  }
  await expect(scroller).toBeVisible();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await testInfo.attach('resized-splits', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
