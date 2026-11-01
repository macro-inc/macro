import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const png = readFileSync(
  new URL('../../../../public/macro-email-logo.png', import.meta.url)
);

test('public and inline images load and open the image viewer', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('https://cdn.example/**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.goto('/attachments.html');
  const thumbnails = page.locator('[data-attachment-part] img');
  await expect(thumbnails).toHaveCount(3);
  await expect
    .poll(() =>
      thumbnails.evaluateAll((elements) =>
        elements.every(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth > 0
        )
      )
    )
    .toBe(true);
  expect(requests).toContain(
    'https://cdn.example/images?thumbnail=1&signature=sample'
  );
  expect(requests).toContain('https://cdn.example/file/photo.png');
  expect(requests.some((url) => url.includes('size=1080'))).toBe(false);
  await page.screenshot({
    path: test.info().outputPath('image-attachments.png'),
  });
  await page.getByRole('button', { name: 'Open image viewer' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('image-viewer.png') });
});
