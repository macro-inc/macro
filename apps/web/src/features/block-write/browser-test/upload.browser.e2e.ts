import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('an early open waits for extraction and renders without reopening', async ({
  page,
}) => {
  const docx = await readFile(
    new URL('../core/fixtures/mutual-nda.docx', import.meta.url)
  );
  let requests = 0;
  let finishExtraction = () => {};
  const extracted = new Promise<void>((resolve) => {
    finishExtraction = resolve;
  });
  await page.route(
    (url) => url.pathname === '/pending-export.docx',
    async (route) => {
      requests++;
      if (requests === 1) {
        await route.fulfill({
          status: 409,
          body: 'Document is still processing.',
        });
        return;
      }
      await extracted;
      await route.fulfill({
        status: 200,
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: docx,
      });
    }
  );

  await page.goto('/?local&src=/pending-export.docx');
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByText('seeding…')).toBeVisible();
  await expect(page.locator('[data-docx-page]')).toHaveCount(0);
  finishExtraction();

  await expect
    .poll(() => page.evaluate(() => window.docxFixture?.ready()))
    .toBe(true);
  await expect(page.locator('[data-docx-page]').first()).toBeVisible();
  const paragraphs = await page.evaluate(() =>
    window.docxFixture?.paragraphs()
  );
  expect(paragraphs?.join('\n')).toContain('MUTUAL NON-DISCLOSURE AGREEMENT');
  expect(requests).toBe(2);
  if (process.env.DOCX_E2E_SHOTS) {
    await page.screenshot({
      path: `${process.env.DOCX_E2E_SHOTS}/upload-ready.png`,
    });
  }
});
