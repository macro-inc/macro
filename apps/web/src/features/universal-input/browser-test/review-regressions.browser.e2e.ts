import { expect, test } from '@playwright/test';

test('underfilled command results load more pages without a scroll gesture', async ({
  page,
}) => {
  await page.goto('/?pagination');
  const results = page.getByRole('listbox', { name: 'Search results' });
  await expect
    .poll(async () =>
      Number(await page.getByTestId('loaded-pages').innerText())
    )
    .toBeGreaterThan(1);
  const scroll = results.locator('.scrollbar-hidden');
  await expect
    .poll(() =>
      scroll.evaluate((element) => element.scrollHeight > element.clientHeight)
    )
    .toBe(true);
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(0);
  expect(
    Number(await page.getByTestId('loaded-pages').innerText())
  ).toBeLessThan(20);
});

test('underfilled command results stop when the last page is exhausted', async ({
  page,
}) => {
  await page.goto('/?pagination&short');
  await expect(page.getByTestId('loaded-pages')).toHaveText('2');
  await expect(
    page.getByRole('listbox', { name: 'Search results' }).getByRole('option')
  ).toHaveCount(4);
});

test('compact subject Enter preserves active IME composition and still blurs otherwise', async ({
  page,
}) => {
  await page.goto('/?compact-subject');
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await subject.fill('日本語');
  const prevented = await subject.evaluate((element) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(subject).toBeFocused();
  await expect(subject).toHaveValue('日本語');
  await subject.press('Enter');
  await expect(subject).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '日本語', exact: true })
  ).toBeVisible();
});
