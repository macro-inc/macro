import { expect, test } from '@playwright/test';

test('closed Soup filters never read the directory, including on Home', async ({
  page,
}) => {
  await page.goto('/?soup-filters=home');
  await expect(page.getByTestId('requests')).toHaveText('0');
  await expect(page.getByTestId('lookup-ids')).toHaveText('[]');
  await page.getByRole('button', { name: 'Show owned files' }).click();
  await expect(page.getByTestId('query-filters')).toContainText(
    'macro|viewer@example.com'
  );
  await expect(page.getByTestId('requests')).toHaveText('0');
});

test('Soup assignees page lazily and retain unknown selections and Unassigned', async ({
  page,
}, info) => {
  const phone = info.project.name === 'phone';
  await page.goto('/?soup-filters=tasks');
  await page.getByRole('button', { name: 'Seed saved filters' }).click();
  await expect(page.getByTestId('requests')).toHaveText('0');
  await page
    .getByRole('button', {
      name: phone ? 'Open filters' : 'Filter',
      exact: true,
    })
    .click();
  if (phone) await page.getByRole('button', { name: /^Assignee/ }).click();
  else
    await page.getByRole('menuitem', { name: 'Assignee', exact: true }).click();
  const input = page.getByPlaceholder('Search assignees...');
  await expect(input).toBeVisible();
  const role = phone ? 'checkbox' : 'option';
  await expect(
    page.getByRole(role, { name: /Unassigned/ }).first()
  ).toBeVisible();
  await expect(
    page.getByRole(role, { name: /unavailable-person/ }).first()
  ).toBeVisible();
  await expect(
    page.getByRole(role, { name: /Viewer \(me\)/ }).first()
  ).toBeVisible();
  if (!phone)
    await page.getByRole('listbox').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await page
    .getByRole(phone ? 'button' : 'option', {
      name: 'Next options',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole(role, { name: /Person 50/ }).first()
  ).toBeInViewport();
  await input.fill('zxq');
  const match = page.getByRole(role, { name: 'Broader match', exact: true });
  await expect(match).toBeVisible();
  if (phone) await match.click();
  else await match.locator('[data-multiselect-checkbox]').click();
  await expect(page.getByTestId('assignees')).toContainText(
    'macro|match@example.com'
  );
  await expect(page.getByTestId('assignees')).toContainText('NO_ASSIGNEE');
  await expect(page.getByTestId('assignees')).toContainText(
    'unavailable-person'
  );
  await expect(page.getByTestId('lookup-ids')).not.toContainText('NO_ASSIGNEE');
  await expect(page.getByTestId('query-filters')).not.toContainText(
    'NO_ASSIGNEE'
  );
  if (!phone) {
    await input.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Assignee', exact: true }).click();
    await expect(page.getByPlaceholder('Search assignees...')).toHaveValue('');
    await expect(
      page.getByRole('option', { name: 'Person 0', exact: true })
    ).toBeVisible();
    await expect(page.getByTestId('assignees')).toContainText(
      'macro|match@example.com'
    );
  }
});

test('Soup chip Only changes its own group and clearing a creator restores Owned', async ({
  page,
}, info) => {
  const phone = info.project.name === 'phone';
  await page.goto('/?soup-filters=tasks');
  await page.getByRole('button', { name: 'Seed saved filters' }).click();
  if (phone) await page.getByRole('button', { name: 'Open filters' }).click();
  await page.getByText('Selected Person', { exact: true }).first().click();
  const input = page.getByPlaceholder('Search assignees...');
  await expect(input).toBeVisible();
  await input.fill('zxq');
  const match = page.getByRole('option', {
    name: 'Broader match',
    exact: true,
  });
  await match.hover();
  await expect(input).toHaveValue('zxq');
  await match
    .getByRole('button', { name: 'Select only Broader match' })
    .click();
  await expect(page.getByTestId('assignees')).toHaveText(
    '["macro|match@example.com"]'
  );
  await expect(input).toHaveValue('zxq');
  await expect(page.getByTestId('query-filters')).toContainText(
    '"documentOwnerId":["macro|selected@example.com"]'
  );
  await input.press('Escape');
  if (phone) await page.getByRole('button', { name: 'Close filters' }).click();
  await page.getByRole('button', { name: 'Show owned files' }).click();
  await page.getByRole('button', { name: 'Refine owned creator' }).click();
  if (phone) await page.getByRole('button', { name: 'Open filters' }).click();
  await page.getByText('Selected Person', { exact: true }).first().click();
  const creator = page.getByRole('option', {
    name: 'Selected Person',
    exact: true,
  });
  await creator.locator('[data-multiselect-checkbox]').click();
  await expect(page.getByTestId('query-filters')).toContainText(
    '"documentOwnerId":["macro|viewer@example.com"]'
  );
});
