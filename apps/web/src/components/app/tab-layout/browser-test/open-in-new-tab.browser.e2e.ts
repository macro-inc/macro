import { expect, type Page, test } from '@playwright/test';

const call = <T>(page: Page, run: string) =>
  page.evaluate(`window.tabsFixture.${run}`) as Promise<T>;

const liveDraft = (page: Page) =>
  page.locator('[data-split-layer]:not([inert])').getByRole('textbox', {
    name: 'Document draft',
  });

test('"Open in new tab" opens the item in a new active tab and leaves the current one', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  await liveDraft(page).fill('first tab draft');

  await call(page, "openInNewTab('doc-two')");
  await expect.poll(() => call<number>(page, 'tabCount()')).toBe(2);
  await expect.poll(() => call<number>(page, 'activeIndex()')).toBe(1);
  await expect(liveDraft(page)).toHaveValue('');
  await expect(page.locator('[data-document]')).toHaveCount(2);

  // The tab it came from still shows its own document.
  await call(page, 'activate(0)');
  await expect(liveDraft(page)).toHaveValue('first tab draft');

  // The intent is spent: a later ordinary open stays in the current tab.
  await call(page, 'openDocument()');
  await expect.poll(() => call<number>(page, 'tabCount()')).toBe(2);
  expect(errors).toEqual([]);
});
