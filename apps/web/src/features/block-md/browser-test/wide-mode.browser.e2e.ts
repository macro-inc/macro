import { expect, type Page, test } from '@playwright/test';

const FIXTURE = '/src/features/block-md/browser-test/wide-mode.html';

async function openDocument(page: Page, query = '') {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(FIXTURE + query);
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

  test('the column only widens as the pane widens', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openDocument(page);
    await page.getByRole('button', { name: 'Turn on wide mode' }).click();
    await expect(
      page.getByRole('button', { name: 'Turn off wide mode' })
    ).toBeVisible();

    // Below the standard column plus 64px margins the text keeps the
    // standard width; past it the column takes the extra room.
    let previous = 0;
    for (const width of [780, 860, 890, 896, 900, 1000]) {
      await page.setViewportSize({ width, height: 1000 });
      const expected = Math.max(Math.min(768, width - 48), width - 128);
      await expect.poll(() => columnWidth(page)).toBe(expected);
      expect(expected).toBeGreaterThanOrEqual(previous);
      previous = expected;
    }
  });

  test('wide mode never narrows the text beside margin comments', async ({
    page,
  }) => {
    // 880px lays the comments out as a rail, 1000px and 1300px as a column
    // beside the text, and 1600px floats them beside the standard column.
    for (const width of [880, 1000, 1300, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await openDocument(page, '?comments');
      const standard = await columnWidth(page);
      // The seeded comment reached the layout: without it the text would be
      // the full standard column at these widths.
      if (width === 880 || width === 1000) expect(standard).toBeLessThan(768);

      await page.getByRole('button', { name: 'Turn on wide mode' }).click();
      await expect(
        page.getByRole('button', { name: 'Turn off wide mode' })
      ).toBeVisible();
      await expect
        .poll(() => columnWidth(page))
        .toBeGreaterThanOrEqual(standard);

      await page.getByRole('button', { name: 'Turn off wide mode' }).click();
      await expect.poll(() => columnWidth(page)).toBe(standard);
    }
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
