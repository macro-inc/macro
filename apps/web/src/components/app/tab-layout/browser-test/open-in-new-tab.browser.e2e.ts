import { expect, type Page, test } from '@playwright/test';

const call = <T>(page: Page, run: string) =>
  page.evaluate(`window.tabsFixture.${run}`) as Promise<T>;

const liveDraft = (page: Page) =>
  page.locator('[data-split-layer]:not([inert])').getByRole('textbox', {
    name: 'Document draft',
  });

const tabCount = (page: Page) => call<number>(page, 'tabCount()');
const activeIndex = (page: Page) => call<number>(page, 'activeIndex()');

test('"Open in new tab" opens the item in a new active tab and leaves the current one', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  await liveDraft(page).fill('first tab draft');

  await call(page, "openInNewTab('doc-two')");
  await expect.poll(() => tabCount(page)).toBe(2);
  await expect.poll(() => activeIndex(page)).toBe(1);
  await expect(liveDraft(page)).toHaveValue('');
  await expect(page.locator('[data-document]')).toHaveCount(2);

  // The intent is spent: the next ordinary open of an unopened item stays in
  // the current tab.
  await call(page, "openInCurrentSplit('doc-three')");
  await expect(page.locator('[data-document]')).toHaveCount(2);
  expect(await tabCount(page)).toBe(2);

  // The tab it came from still shows its own document.
  await call(page, 'activate(0)');
  await expect(liveDraft(page)).toHaveValue('first tab draft');
  expect(errors).toEqual([]);
});

test('"Open in new tab" on an item open in the current tab opens another instance', async ({
  page,
}) => {
  await page.goto('/');
  await liveDraft(page).fill('first tab draft');

  await call(page, "openInNewTab('doc-one')");
  await expect.poll(() => tabCount(page)).toBe(2);
  await expect.poll(() => activeIndex(page)).toBe(1);
  await expect(liveDraft(page)).toHaveValue('');
  await expect(page.locator('[data-document]')).toHaveCount(2);

  await call(page, 'activate(0)');
  await expect(liveDraft(page)).toHaveValue('first tab draft');
});
