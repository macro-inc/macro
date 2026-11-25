import { expect, type Page, test } from '@playwright/test';

const KEYBOARD = 336;

/** Every change to <html>'s inline style from here on, by property. */
async function recordRootWrites(page: Page) {
  await page.evaluate(() => {
    const root = document.documentElement;
    const writes: string[] = [];
    Object.assign(window, { rootWrites: writes });
    new MutationObserver((records) => {
      for (const record of records) writes.push(record.oldValue ?? '');
    }).observe(root, {
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true,
    });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { rootWrites: string[] }).rootWrites
    );
}

// Computed padding and layout boxes round differently (1/64 px in Chromium).
const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

async function box(page: Page, testId: string) {
  const bounds = await page.getByTestId(testId).boundingBox();
  if (!bounds) throw new Error(`${testId} is not rendered`);
  return bounds;
}

/** The content's bottom padding, the float host's height, the frame's. */
async function insets(page: Page) {
  return page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(
      '[data-testid="content"]'
    )!;
    const host = document.querySelector('[data-float-region]')!.parentElement!;
    return {
      contentPadding: Number.parseFloat(
        getComputedStyle(content).paddingBottom
      ),
      spacer: document
        .querySelector('[data-testid="spacer"]')!
        .getBoundingClientRect().height,
      host: host.getBoundingClientRect().height,
      frame: document
        .querySelector('[data-testid="frame"]')!
        .getBoundingClientRect().height,
      root: document.getElementById('root')!.getBoundingClientRect().height,
      // A row inside the content: the inset is not inherited down to it.
      rowInset: getComputedStyle(
        document.querySelector('[data-row="0"]')!
      ).getPropertyValue('--mobile-content-inset-bottom'),
    };
  });
}

// The iOS app's keyboard: the bridge dispatches keyboardWillShow/Hide with
// the keyboard's height, and the WebView keeps its full size.
const showKeyboard = (page: Page) =>
  page.evaluate(
    (height) =>
      window.dispatchEvent(
        new CustomEvent('keyboardWillShow', { detail: { height, duration: 0 } })
      ),
    KEYBOARD
  );
const hideKeyboard = (page: Page) =>
  page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('keyboardWillHide', { detail: null }))
  );

test('keyboard and composer growth move the bottom chrome without writing to <html>', async ({
  page,
}) => {
  await page.goto('/insets.html?native=ios&rows=60');
  const composer = page.getByTestId('composer');
  await expect(page.getByTestId('dock')).toBeVisible();
  const viewport = {
    height: await page.evaluate(() => window.innerHeight),
  };
  const sheetBottom = async () => {
    const sheet = await box(page, 'sheet');
    return viewport.height - sheet.y - sheet.height;
  };
  const rootWrites = await recordRootWrites(page);

  const resting = await insets(page);
  expect(resting.contentPadding).toBeCloseTo(resting.host, 0);
  expect(resting.spacer).toBeCloseTo(resting.host, 0);
  expect(resting.frame).toBe(viewport.height);
  expect(resting.rowInset).toBe('');
  expect(await sheetBottom()).toBeCloseTo(8, 0);

  await composer.focus();
  await showKeyboard(page);
  // The app frame and the chrome on it sit above the keyboard; the dock
  // steps aside for the composer.
  await expect(page.getByTestId('dock')).toBeHidden();
  await expect
    .poll(async () => (await insets(page)).frame)
    .toBe(viewport.height - KEYBOARD);
  const typing = await insets(page);
  expect(typing.root).toBe(viewport.height - KEYBOARD);
  expect(typing.host).toBeLessThan(resting.host);
  await expect
    .poll(async () => {
      const shown = await insets(page);
      return near(shown.contentPadding, shown.host);
    })
    .toBe(true);
  const composerBox = await box(page, 'composer');
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(
    viewport.height - KEYBOARD
  );
  // Fixed sheets lift by the keyboard's height.
  expect(await sheetBottom()).toBeCloseTo(KEYBOARD + 8, 0);

  // Each new line grows the chrome, and the content's clearance follows it.
  for (let line = 2; line <= 4; line++) {
    const before = (await insets(page)).host;
    await composer.press('End');
    await composer.press('Enter');
    await expect
      .poll(async () => (await insets(page)).host)
      .toBeGreaterThan(before);
    // The host publishes its new height from a ResizeObserver, a frame on.
    await expect
      .poll(async () => {
        const grown = await insets(page);
        return [
          near(grown.contentPadding, grown.host),
          near(grown.spacer, grown.host),
        ];
      })
      .toEqual([true, true]);
  }
  // The composer stops growing at a third of the space above the keyboard.
  const cap = (viewport.height - KEYBOARD) * 0.32;
  for (let line = 0; line < 20; line++) await composer.press('Enter');
  expect((await box(page, 'composer')).height).toBeLessThanOrEqual(cap + 1);

  await hideKeyboard(page);
  await composer.blur();
  await expect(page.getByTestId('dock')).toBeVisible();
  await expect
    .poll(async () => (await insets(page)).frame)
    .toBe(viewport.height);
  await expect
    .poll(async () => {
      const after = await insets(page);
      return near(after.contentPadding, after.host);
    })
    .toBe(true);

  // A custom property on <html> is inherited by every element, so each of
  // these changes used to restyle the whole page.
  expect(await rootWrites()).toEqual([]);
});
