import { expect, test } from '@playwright/test';
import { scrollList } from './scroll-gesture';

test('CRM keeps team owner options scoped and resolves chip suggestions without a directory catalog', async ({
  page,
}, info) => {
  const phone = info.project.name === 'phone';
  await page.goto('/?soup-filters=crm');
  await page.getByRole('button', { name: 'Seed saved filters' }).click();
  await expect(page.getByTestId('requests')).toHaveText('0');
  if (!phone) {
    await expect(
      page.getByText('Selected Person', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Owner', exact: true }).click();
    await expect(
      page.getByRole('option', { name: 'No owner', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: /teammate@example.com/ })
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'Selected Person', exact: true })
    ).toHaveCount(0);
    await expect(page.getByTestId('requests')).toHaveText('0');
    await page.getByPlaceholder('Search owners...').press('Escape');
    await page.keyboard.press('Escape');
  }
  // CRM renders the same active-filter chips below its header on touch.
  await page.getByText('Selected Person', { exact: true }).click();
  const input = page.getByPlaceholder('Search owners...');
  await expect(input).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'No owner', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'unavailable-person', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'Person 0', exact: true })
  ).toBeVisible();
  // Reaching the end of the list lists the next page below the first.
  const list = page.getByRole('listbox');
  await scrollList(list, 3000);
  const nextPage = page.getByRole('option', { name: 'Person 50', exact: true });
  await expect(nextPage).toBeAttached();
  await scrollList(list, 150);
  await expect(nextPage).toBeInViewport();
  await input.fill('zxq');
  const match = page.getByRole('option', {
    name: 'Broader match',
    exact: true,
  });
  await match.hover();
  await match
    .getByRole('button', { name: 'Select only Broader match' })
    .click();
  await expect(page.getByTestId('owners')).toHaveText(
    '["macro|match@example.com"]'
  );
  await expect(page.getByTestId('stages')).toHaveText('["kept-stage"]');
  await expect(page.getByTestId('lookup-ids')).not.toContainText('NO_ASSIGNEE');
});
