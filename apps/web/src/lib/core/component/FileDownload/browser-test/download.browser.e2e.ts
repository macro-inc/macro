import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const videoPath = new URL(
  '../../../../../features/block-pptx/browser-test/fixtures/clip.webm',
  import.meta.url
);

test.beforeEach(async ({ page }) => {
  const video = await readFile(videoPath);
  await page.route('**/file/download-video', (route) =>
    route.fulfill({ body: video, contentType: 'video/webm' })
  );
  await page.route('**/api/file/metadata/download-video', (route) =>
    route.fulfill({
      json: {
        file_id: 'download-video',
        file_name: 'Team demo.webm',
        content_type: 'video/webm',
        is_uploaded: true,
        owner_id: 'test-user',
        s3_key: 'test-video',
      },
    })
  );
  await page.goto('/');
});

test('downloads the original video from the message and expanded viewer', async ({
  page,
}) => {
  const action = 'Download';
  const clickDownload = async () => {
    await page
      .getByRole('button', { name: action, exact: true })
      .last()
      .click();
  };
  const firstDownload = page.waitForEvent('download');
  await clickDownload();
  const first = await firstDownload;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(first.suggestedFilename()).toBe('Team demo.webm');
  expect(await readFile((await first.path())!)).toEqual(
    await readFile(videoPath)
  );
  await page
    .getByRole('button', { name: 'Open video viewer', exact: true })
    .first()
    .click();
  const secondDownload = page.waitForEvent('download');
  await clickDownload();
  expect((await secondDownload).suggestedFilename()).toBe('Team demo.webm');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Open video viewer', exact: true }).first()
  ).toBeFocused();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((body) => body.clientWidth)
  );
});

test('recovers from a failed transfer and never opens the viewer when downloading', async ({
  page,
}) => {
  let failed = false;
  const video = await readFile(videoPath);
  await page.route('**/file/download-video', (route) => {
    if (route.request().resourceType() === 'media' || failed)
      return route.fulfill({ body: video, contentType: 'video/webm' });
    failed = true;
    return route.fulfill({ status: 404 });
  });
  await page
    .getByRole('button', {
      name: 'Download',
      exact: true,
    })
    .click();
  await expect(page.locator('video[controls]')).toHaveCount(0);
  const saved = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Retry download', exact: true })
    .click();
  expect((await saved).suggestedFilename()).toBe('Team demo.webm');
  await expect(
    page.getByRole('button', {
      name: 'Download',
      exact: true,
    })
  ).toBeFocused();
});

test('the shared Drive and standalone header downloads through its visible action', async ({
  page,
}) => {
  await page.goto('/?header');
  const trigger = page.getByRole('button', {
    name: 'Download',
    exact: true,
  });
  const saved = page.waitForEvent('download');
  await trigger.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('Team demo.webm');
  expect(await readFile((await file.path())!)).toEqual(
    await readFile(videoPath)
  );
  await expect(trigger).toBeFocused();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((body) => body.clientWidth)
  );
});

test('downloads a linked video using its current version and original extension', async ({
  page,
}) => {
  const video = await readFile(videoPath);
  await page.route('**/documents/linked-video', (route) =>
    route.fulfill({
      json: {
        data: {
          documentMetadata: {
            documentId: 'linked-video',
            documentVersionId: 42,
            documentName: 'birds folder',
            fileType: 'webm',
          },
          userAccessLevel: 'view',
        },
      },
    })
  );
  await page.route('**/documents/linked-video/location_v3?*', (route) => {
    expect(
      new URL(route.request().url()).searchParams.get('document_version_id')
    ).toBe('42');
    return route.fulfill({
      json: {
        type: 'presignedUrl',
        presignedUrl: new URL('/original-video', page.url()).href,
        content: { state: 'ready' },
      },
    });
  });
  await page.route('**/original-video', (route) =>
    route.fulfill({ body: video, contentType: 'video/webm' })
  );
  await page.goto('/?document');
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('birds folder.webm');
  expect(await readFile((await file.path())!)).toEqual(video);
});

test('shares from the mobile Download menu after a transfer outlives browser activation', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'System sharing is inside the touch Download menu');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive: false },
    });
    Object.defineProperty(navigator, 'share', {
      value: async (data: ShareData) => {
        Object.defineProperty(window, 'sharedFileName', {
          configurable: true,
          value: data.files?.[0]?.name,
        });
      },
    });
  });
  await page.reload();
  const trigger = page.getByRole('button', { name: 'Download', exact: true });
  await trigger.click();
  const share = page.getByRole('menuitem', { name: 'Share', exact: true });
  await share.click();
  await expect(
    page.getByText('File ready — tap Share', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, 'sharedFileName'))
  ).toBeUndefined();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saving = page.waitForEvent('download');
  const download = page.getByRole('menuitem', {
    name: 'Download',
    exact: true,
  });
  await download.click();
  expect((await saving).suggestedFilename()).toBe('Team demo.webm');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await share.click();
  await expect(
    page.getByText('File ready — tap Share', { exact: true })
  ).toBeVisible();
  await share.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'sharedFileName')))
    .toBe('Team demo.webm');
  await expect(trigger).toBeFocused();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((body) => body.clientWidth)
  );
});
