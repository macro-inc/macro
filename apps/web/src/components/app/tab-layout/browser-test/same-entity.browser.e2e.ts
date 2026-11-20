import { expect, type Page, test } from '@playwright/test';

type Fixture = {
  newTab(): void;
  activate(index: number): void;
  close(index: number): void;
  openDocument(): string;
};

const call = <T>(page: Page, run: string) =>
  page.evaluate(`window.tabsFixture.${run}`) as Promise<T>;

const liveDraft = (page: Page) =>
  page.locator('[data-split-layer]:not([inert])').getByRole('textbox', {
    name: 'Document draft',
  });

test('a document open in one tab opens as its own instance in another', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  await liveDraft(page).fill('first tab draft');

  await call<Fixture>(page, 'newTab()');
  await expect(liveDraft(page)).toHaveCount(0);

  await expect(call<string>(page, 'openDocument()')).resolves.not.toBe(
    'reused'
  );
  await expect(liveDraft(page)).toHaveValue('');
  await expect(page.getByText('Content already open.')).toHaveCount(0);
  await liveDraft(page).fill('second tab draft');
  await expect(page.locator('[data-document]')).toHaveCount(2);

  await call<Fixture>(page, 'activate(0)');
  await expect(liveDraft(page)).toHaveValue('first tab draft');
  await call<Fixture>(page, 'activate(1)');
  await expect(liveDraft(page)).toHaveValue('second tab draft');

  // Reopening within the tab keeps the one instance.
  await expect(call<string>(page, 'openDocument()')).resolves.toBe('reused');
  await expect(page.locator('[data-document]')).toHaveCount(2);

  await call<Fixture>(page, 'close(1)');
  await expect(page.locator('[data-document]')).toHaveCount(1);
  await expect(liveDraft(page)).toHaveValue('first tab draft');
  expect(errors).toEqual([]);
});
