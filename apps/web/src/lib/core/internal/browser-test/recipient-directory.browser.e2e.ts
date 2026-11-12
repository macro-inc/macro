import { expect, test } from '@playwright/test';

test('pages recipients without retaining earlier options or dropping custom selections', async ({
  page,
}, info) => {
  await page.goto('/?recipient-directory');
  await expect(page.getByTestId('reads')).toHaveText('0');
  const input = page.getByRole('combobox');
  await input.click();
  await expect(
    page.getByRole('option', { name: /Person 000000/ })
  ).toBeVisible();
  await expect(page.getByTestId('loaded')).toHaveText('50');
  if (info.project.name === 'phone')
    await page.getByRole('button', { name: 'Next options' }).tap();
  else await input.press('PageDown');
  await expect(
    page.getByRole('option', { name: /Person 000050/ })
  ).toBeVisible();
  await expect(page.getByRole('option', { name: /Person 000000/ })).toHaveCount(
    0
  );
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
  await expect(
    page.getByRole('button', { name: 'Next options' })
  ).toBeVisible();
});

test('advances an empty window and preserves chips when closing or changing queries', async ({
  page,
}, info) => {
  await page.goto('/?recipient-directory');
  const input = page.getByRole('combobox');
  await input.fill('empty');
  await expect(page.getByTestId('loaded')).toHaveText('0');
  await expect(
    page.getByRole('button', { name: 'Next options' })
  ).toBeVisible();
  if (info.project.name === 'phone')
    await page.getByRole('button', { name: 'Next options' }).tap();
  else await input.press('PageDown');
  await expect(page.getByRole('option', { name: /Empty later/ })).toBeVisible();
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
