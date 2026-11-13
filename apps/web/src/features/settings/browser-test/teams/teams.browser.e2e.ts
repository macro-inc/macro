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

test('pressing Enter again while a team is being created creates it once', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    (
      window as unknown as { teamsService: { delays: Record<string, number> } }
    ).teamsService.delays.createSubteam = 500;
  });

  await page.getByRole('button', { name: 'New team' }).click();
  const name = page.getByRole('dialog').getByLabel('Name');
  await name.fill('Design');
  await name.press('Enter');
  await name.press('Enter');
  await expect(page.getByLabel('Team name')).toHaveValue('Design');

  await page.getByRole('button', { name: 'Teams' }).first().click();
  const list = page.locator('[data-settings-page]');
  await expect(list.getByRole('button', { name: /Design/ })).toHaveCount(1);
});

test('a failed load offers a retry instead of an empty list', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      teamsService: {
        delays: {},
        // The app retries a failed load once.
        failures: ['listSubteams', 'listSubteams'],
        failed: [],
      },
    });
  });
  await page.goto('/');

  await expect(page.getByText("Couldn't load teams")).toBeVisible();
  await expect(page.getByText('No teams yet')).toHaveCount(0);

  await page.getByRole('button', { name: 'Retry' }).click();
  const list = page.locator('[data-settings-page]');
  await expect(list.getByRole('button', { name: /Engineering/ })).toBeVisible();
});

test('one failed addition keeps the people added alongside it', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const service = (
      window as unknown as {
        teamsService: { delays: Record<string, number>; failures: string[] };
      }
    ).teamsService;
    service.delays['saveSubteamMember:macro|grace@example.com'] = 600;
    service.failures.push('saveSubteamMember:macro|grace@example.com');
  });

  const list = page.locator('[data-settings-page]');
  await list.getByRole('button', { name: /Engineering/ }).click();
  await page.getByRole('button', { name: 'Add people' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Grace Hopper').click();
  await dialog.getByText('Linus Pauling').click();
  await dialog
    .getByRole('button', { name: /^Add\b/ })
    .last()
    .click();

  // Linus's request succeeds first; Grace's fails after it.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { teamsService: { failed: string[] } })
            .teamsService.failed.length
      )
    )
    .toBe(1);
  await expect(page.getByText('grace@example.com')).toHaveCount(0);
  await expect(page.getByText('linus@example.com')).toBeVisible();
});

test('clearing the name puts the team name back', async ({ page }) => {
  await page.goto('/');

  const list = page.locator('[data-settings-page]');
  await list.getByRole('button', { name: /Engineering/ }).click();
  const name = page.getByLabel('Team name');
  await name.fill('');
  await name.blur();
  await expect(name).toHaveValue('Engineering');
});

test("a member's avatar in a team row opens the team", async ({ page }) => {
  await page.goto('/');

  const list = page.locator('[data-settings-page]');
  await list
    .getByRole('button', { name: /Engineering/ })
    .getByText('AT')
    .click();
  await expect(page.getByLabel('Team name')).toHaveValue('Engineering');
});
