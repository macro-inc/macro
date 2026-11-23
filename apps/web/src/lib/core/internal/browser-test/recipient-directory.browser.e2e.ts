import { expect, type Page, test } from '@playwright/test';
import { scrollList } from './scroll-gesture';

function optionsScrollTop(page: Page) {
  return page.getByRole('listbox').evaluate((listbox) => {
    const scroller = [listbox, ...listbox.querySelectorAll('*')].find(
      (element) =>
        element instanceof HTMLElement &&
        ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
    );
    return scroller?.scrollTop ?? 0;
  });
}

test('pages recipients below the earlier options as the list scrolls, keeping custom selections', async ({
  page,
}) => {
  await page.goto('/?recipient-directory');
  await expect(page.getByTestId('reads')).toHaveText('0');
  const input = page.getByRole('combobox');
  await input.click();
  await expect(
    page.getByRole('option', { name: /Person 000000/ })
  ).toBeVisible();
  await expect(page.getByTestId('loaded')).toHaveText('50');
  await expect(page.getByTestId('reads')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Next options' })).toHaveCount(
    0
  );

  await scrollList(page.getByRole('listbox'));
  await expect(page.getByTestId('reads')).toHaveText('2');
  const scrolled = await optionsScrollTop(page);
  expect(scrolled).toBeGreaterThan(0);
  // The next page lists below the rows on screen; the list stays where it was.
  await expect(
    page.getByRole('option', { name: /Person 000049/ })
  ).toBeVisible();
  expect(await optionsScrollTop(page)).toBe(scrolled);
  await scrollList(page.getByRole('listbox'));
  await expect(
    page.getByRole('option', { name: /Person 000099/ })
  ).toBeVisible();
  await expect(page.getByTestId('reads')).toHaveText('3');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('recipients')).toHaveText(
    '["macro|outside@example.com"]'
  );

  await input.fill('rare');
  await expect(page.getByRole('option', { name: /Rare Person/ })).toBeVisible();
  await expect(page.getByTestId('loaded')).toHaveText('1');
  await input.press('Enter');
  await expect(page.getByTestId('recipients')).toHaveText(
    '["macro|outside@example.com","macro|person99999@example.com"]'
  );
  await input.press('Escape');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.getByTestId('queries')).toHaveText('1');
});

test('PageDown lists the next page on desktop', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Keyboard paging is desktop-only');
  await page.goto('/?recipient-directory');
  const input = page.getByRole('combobox');
  await input.click();
  await expect(page.getByTestId('reads')).toHaveText('1');
  await input.press('PageDown');
  await expect(page.getByTestId('reads')).toHaveText('2');
  await expect(page.getByTestId('loaded')).toHaveText('50');
  await expect(input).toBeFocused();
});

test('selects an initial asynchronous match and keeps the next typed query open', async ({
  page,
}) => {
  await page.goto('/?recipient-directory');
  const input = page.getByRole('combobox');
  await input.fill('rare');
  await expect(page.getByRole('option', { name: /Rare Person/ })).toBeVisible();
  await input.press('Enter');
  await expect(page.getByTestId('recipients')).toHaveText(
    '["macro|outside@example.com","macro|person99999@example.com"]'
  );
  await input.fill('empty');
  await expect(page.getByRole('option', { name: /Empty later/ })).toBeVisible();
});

test('reads past an empty window by itself and preserves chips when closing or changing queries', async ({
  page,
}) => {
  await page.goto('/?recipient-directory');
  const input = page.getByRole('combobox');
  await input.fill('empty');
  // The empty first page continues without a button.
  await expect(page.getByRole('option', { name: /Empty later/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next options' })).toHaveCount(
    0
  );
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: 'Outside picker' }).click();
  await expect(page.getByTestId('recipients')).toHaveText(
    '["macro|outside@example.com"]'
  );
  await expect(page.getByRole('option')).toHaveCount(0);
  await input.fill('rare');
  await expect(page.getByRole('option', { name: /Rare Person/ })).toBeVisible();
  await expect(page.getByTestId('recipients')).toHaveText(
    '["macro|outside@example.com"]'
  );
});
