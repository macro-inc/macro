import { expect, test } from '@playwright/test';

const IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAABVUlEQVR4nO3aQQ2AMBQFwTrCFGeEoQQl6MAC6YGE7ST/Pm32+sZ+3tO3Hdf0cb9xx2ofXs0VOO4KHHcFjrsCx12B467AcVfguCtw3BU47gocdwWOuwLHXYHjrsBxV+C4K3DcFTjuChx3xx8fzX1/AsddgeOuwHFX4LgrcNwVOO4KHHcFjrsCx12B467AcVfguCtw3BU47gocdwWOuwLHXYHjrsBx1+gu7gocdwWOuwLHXYHjrsBxV+C4K3DcFTjuChx3BY67AsddgeOuwHFX4LgrcNwVOO4KHHcFjrsCx12ju7grcNwVOO4KHHcFjrsCx12B467AcVfguCtw3BU47gocdwWOuwLHXYHjrsBxV+C4K3DcFTjuChx3je7irsBxV+C4K3DcFTjuChx3BY67AsddgeOuwHFX4LgrcNwVOO4KHHcFjrsCx12B467AcVfguCtw3H0A1UmjWQj5J0YAAAAASUVORK5CYII=';

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      await route.continue();
    else
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/');
  await expect(page.locator('[data-markdown-editable]')).toBeVisible({
    timeout: 60_000,
  });
});

test('pastes an image, waits for its upload and sends an inline image with multiline text', async ({
  page,
}, testInfo) => {
  const editor = page.locator('[data-markdown-editable]');
  await editor.click();
  await page.keyboard.type('First line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second line');
  await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([bytes], { type: 'image/png' }),
      }),
    ]);
  }, IMAGE);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(
    page.locator('[data-input-attachments="media"] img[src^="blob:"]')
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Share', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Finish uploads' }).click();
  await expect(
    page.getByRole('button', { name: 'Share', exact: true })
  ).toBeEnabled();
  await page
    .locator('section')
    .screenshot({ path: testInfo.outputPath('share-image.png') });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const sent = JSON.parse(await page.getByLabel('Sent message').innerText());
  expect(sent.content).toContain('First line');
  expect(sent.content).toContain('Second line');
  expect(sent.content).toContain('\n');
  expect(sent.attachments).toEqual([
    {
      entity_type: 'static/image',
      entity_id: expect.any(String),
      width: 160,
      height: 100,
    },
  ]);
});

test('removing an uploading image keeps it out of the message', async ({
  page,
}) => {
  await page.locator('[data-input-attach-file-picker]').setInputFiles({
    name: 'removed.png',
    mimeType: 'image/png',
    buffer: Buffer.from(IMAGE, 'base64'),
  });
  await page
    .getByRole('button', { name: 'Remove removed.png', exact: true })
    .click();
  await page.getByRole('button', { name: 'Finish uploads' }).click();
  await expect(
    page.getByRole('button', { name: 'Share', exact: true })
  ).toBeEnabled();
  await expect(page.locator('[data-input-attachments="media"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  expect(
    JSON.parse(await page.getByLabel('Sent message').innerText()).attachments
  ).toEqual([]);
});

test('accepts a dropped image and lets an upload failure recover', async ({
  page,
}) => {
  const transfer = await page.evaluateHandle((encoded) => {
    const data = new DataTransfer();
    const file = new File(
      [Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))],
      'dropped.png',
      { type: 'image/png' }
    );
    const item = data.items.add(file);
    // Hold filesystem preparation so the send guard is exercised before an
    // attachment has reached the uploader.
    Object.defineProperty(item, 'webkitGetAsEntry', {
      value: () => ({
        isFile: true,
        isDirectory: false,
        file: (ready: (file: File) => void) => {
          document
            .querySelector('[data-release-file]')
            ?.addEventListener('click', () => ready(file), { once: true });
        },
      }),
    });
    return data;
  }, IMAGE);
  await page
    .locator('[data-markdown-editable]')
    .dispatchEvent('drop', { dataTransfer: transfer });
  await expect(
    page.getByRole('button', { name: 'Share', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Read dropped file' }).click();
  await page.getByRole('button', { name: 'Fail uploads' }).click();
  await expect(page.locator('[data-input-attachments="media"]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Share', exact: true })
  ).toBeEnabled();
  await page.locator('[data-input-attach-file-picker]').setInputFiles({
    name: 'retry.png',
    mimeType: 'image/png',
    buffer: Buffer.from(IMAGE, 'base64'),
  });
  await page.getByRole('button', { name: 'Finish uploads' }).click();
  await expect(
    page.getByRole('button', { name: 'Share', exact: true })
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Remove retry.png' })
  ).toBeAttached();
  await page.getByRole('button', { name: 'Close share' }).click();
  await page.getByRole('button', { name: 'Open share' }).click();
  await expect(page.locator('[data-input-attachments="media"]')).toHaveCount(0);
});
