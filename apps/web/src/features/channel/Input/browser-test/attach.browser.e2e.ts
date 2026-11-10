import { expect, type Page, test } from '@playwright/test';

const PHOTO_LIBRARY = 'plugin:photo-library|pick_photo_library_images';

/**
 * Stands in for the iOS app's Tauri bridge. Commands other than the photo
 * library reject, which the app already tolerates at startup.
 */
async function emulateIosApp(page: Page, photoLibrary: 'fails') {
  await page.addInitScript((outcome) => {
    const host = window as unknown as Record<string, unknown>;
    const invoked: string[] = [];
    host.__photoLibraryInvokes = invoked;
    host.isTauri = true;
    host.__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: 'ios', platform: 'ios' };
    host.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
      convertFileSrc: (path: string) => `asset://localhost/${path}`,
      transformCallback: () => 0,
      unregisterCallback: () => {},
      invoke: async (command: string) => {
        if (command === 'plugin:photo-library|pick_photo_library_images') {
          invoked.push(command);
          if (outcome === 'fails')
            throw new Error('Photo library picker cannot be presented');
        }
        throw new Error(`No native command ${command}`);
      },
    };
  }, photoLibrary);
}

async function openPhone(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"responses":[]}',
      });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/src/features/channel/Input/browser-test/draft.html');
  await expect(page.locator('[data-markdown-editable]')).toBeAttached({
    timeout: 60_000,
  });
}

async function tapAttach(page: Page) {
  await page.getByRole('button', { name: 'Add', exact: true }).tap();
  await page.locator('[data-composer-add-item="attach"]').tap();
}

test('a phone browser opens the file picker from the add drawer', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await openPhone(page);

  const chooser = page.waitForEvent('filechooser');
  await tapAttach(page);
  expect((await chooser).isMultiple()).toBe(true);
  await context.close();
});

test('the iOS app offers the file picker behind a tap when the photo library fails', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await emulateIosApp(page, 'fails');
  await openPhone(page);
  let choosers = 0;
  page.on('filechooser', () => {
    choosers += 1;
  });

  await tapAttach(page);

  // WKWebView ignores a file input click once the native round trip has
  // outlived the tap, so the composer must not count on one.
  const chooseFiles = page.getByRole('button', { name: 'Choose files' });
  await expect(chooseFiles).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __photoLibraryInvokes: string[] })
          .__photoLibraryInvokes
    )
  ).toEqual([PHOTO_LIBRARY]);
  expect(choosers).toBe(0);

  const chooser = page.waitForEvent('filechooser');
  await chooseFiles.tap();
  await chooser;
  await expect(chooseFiles).toBeHidden();
  await context.close();
});
