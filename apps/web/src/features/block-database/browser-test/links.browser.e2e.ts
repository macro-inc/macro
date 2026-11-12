import { expect, type Page, test } from '@playwright/test';
import { openFixture } from './open-fixture';

/** Records the URLs the page opens instead of opening tabs. */
async function openLinksFixture(page: Page) {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { opened });
    window.open = (url) => {
      opened.push(String(url));
      return null;
    };
  });
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html?links'
  );
}

function opened(page: Page) {
  return page.evaluate(
    () => (window as unknown as { opened: string[] }).opened
  );
}

test('links in text and URL cells open, and the cells still edit', async ({
  page,
}) => {
  await openLinksFixture(page);
  const grid = page.getByRole('grid', { name: 'Embedded records' });

  await grid.getByRole('link', { name: 'https://example.com/spec' }).click();
  expect(await opened(page)).toEqual(['https://example.com/spec']);
  await expect(grid.getByRole('textbox')).toHaveCount(0);

  await grid.getByText('Spec at').click();
  await expect(grid.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');

  const website = grid.getByRole('link', { name: 'example.com', exact: true });
  await website.click();
  expect(await opened(page)).toEqual([
    'https://example.com/spec',
    'https://example.com',
  ]);
  await expect(grid.getByRole('textbox')).toHaveCount(0);

  const cell = grid.getByRole('button', { name: /^Website: example\.com/ });
  await cell.focus();
  await cell.press('Enter');
  await expect(grid.getByRole('textbox')).toHaveValue('example.com');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await website.click();
  expect(await opened(page)).toHaveLength(3);
});

test.describe('touch links', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test('tapping a URL opens it without editing the cell', async ({ page }) => {
    await openLinksFixture(page);
    const grid = page.getByRole('grid', { name: 'Embedded records' });
    await grid.getByRole('link', { name: 'example.com', exact: true }).tap();
    expect(await opened(page)).toEqual(['https://example.com']);
    await expect(grid.getByRole('textbox')).toHaveCount(0);
  });
});
