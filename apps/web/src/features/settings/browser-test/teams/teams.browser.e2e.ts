import { expect, test } from '@playwright/test';

test('a workspace owner creates a team and arranges teams', async ({
  page,
}) => {
  await page.goto('/');

  const list = page.locator('[data-settings-page]');
  await expect(list.getByRole('button', { name: /Engineering/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Platform/ })).toBeVisible();
  await expect(list.getByText('3 people')).toBeVisible();

  await page.getByRole('button', { name: 'New team' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Design');
  await dialog.getByText('Grace Hopper').click();
  await dialog.getByRole('button', { name: 'Create team' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByLabel('Team name')).toHaveValue('Design');
  await expect(page.getByText('grace@example.com')).toBeVisible();
  await expect(page.getByText('ada@example.com')).toBeVisible();

  await page.getByRole('button', { name: 'Teams' }).first().click();
  await expect(list.getByRole('button', { name: /Design/ })).toBeVisible();
  await expect(list.getByText('2 people')).toBeVisible();

  await list.getByRole('button', { name: /Engineering/ }).click();
  await expect(page.getByRole('button', { name: 'None' })).toBeDisabled();
  await page
    .getByRole('radiogroup', { name: 'Who can join' })
    .getByText('Invite only')
    .click();
  await page.getByRole('button', { name: 'Teams' }).first().click();
  await expect(
    list.getByRole('button', { name: /Engineering/ }).getByLabel('Invite only')
  ).toBeVisible();

  await list.getByRole('button', { name: /Platform/ }).click();
  await page.getByRole('button', { name: 'Engineering', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'None' }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.getByRole('button', { name: 'None' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Engineering /' })).toHaveCount(
    0
  );
});

test('a member joins and leaves open teams but cannot edit them', async ({
  page,
}) => {
  await page.goto('/?as=grace');

  const list = page.locator('[data-settings-page]');
  await list.getByRole('button', { name: /Platform/ }).click();
  await expect(page.getByRole('heading', { name: 'Platform' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Engineering /' }).click();
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByText('grace@example.com')).toBeVisible();
  await expect(page.getByLabel('Team name')).toHaveCount(0);

  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByText('grace@example.com')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Join' })).toBeVisible();
});
