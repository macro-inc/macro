import { expect, type Page, test } from '@playwright/test';

const FIXTURE = '/src/features/block-md/browser-test/wide-mode.html';

async function openDocument(page: Page) {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(FIXTURE);
  await expect(page.getByText('Roadmap')).toBeVisible({ timeout: 30_000 });
}

async function columnWidth(page: Page): Promise<number> {
  const box = await page
    .getByRole('textbox', { name: 'Document content' })
    .boundingBox();
  if (!box) throw new Error('Document content is not rendered');
  return box.width;
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Wide mode is desktop and tablet only');

  test('wide mode fills the pane and survives a reload', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openDocument(page);
    expect(await columnWidth(page)).toBe(768);

    await page.getByRole('button', { name: 'Turn on wide mode' }).click();
    await expect(
      page.getByRole('button', { name: 'Turn off wide mode' })
    ).toBeVisible();
    // The pane less its 64px gutters, which keep room for the outline.
    await expect.poll(() => columnWidth(page)).toBe(1600 - 2 * 64);

    await page.reload();
    await expect(page.getByText('Roadmap')).toBeVisible({ timeout: 30_000 });
    expect(await columnWidth(page)).toBe(1600 - 2 * 64);

    await page.getByRole('button', { name: 'Turn off wide mode' }).click();
    await expect.poll(() => columnWidth(page)).toBe(768);
  });

  test('a pane narrower than the column looks the same either way', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 1000 });
    await openDocument(page);
    const standard = await columnWidth(page);

    await page.getByRole('button', { name: 'Turn on wide mode' }).click();
    await expect(
      page.getByRole('button', { name: 'Turn off wide mode' })
    ).toBeVisible();
    expect(await columnWidth(page)).toBe(standard);
  });
});

test('phones offer no wide mode', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone only');
  await openDocument(page);
  await expect(page.getByRole('button', { name: 'Ask Macro' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Turn on wide mode' })
  ).toHaveCount(0);
});
