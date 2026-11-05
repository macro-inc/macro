import { expect, test } from '@playwright/test';

test('keeps header control heights equal and routes every invitation choice', async ({
  page,
}) => {
  await page.goto('/?members');
  const agent = page.getByRole('button', { name: 'Invite agent', exact: true });
  const invite = page.getByRole('button', { name: 'Invite', exact: true });
  const options = page.getByRole('button', {
    name: 'Invite options',
    exact: true,
  });
  await expect(agent).toBeVisible();
  const heights = await Promise.all(
    [agent, invite, options].map(
      async (control) => (await control.boundingBox())!.height
    )
  );
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(0.5);
  await agent.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Invitation:' })
  ).toContainText('Invitation: agent');
  await invite.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Invitation:' })
  ).toContainText('Invitation: person');
  await options.click();
  await page
    .getByRole('menuitem', { name: 'Invite an agent', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Invitation:' })
  ).toContainText('Invitation: agent');
  await options.click();
  await page
    .getByRole('menuitem', { name: 'Invite a person', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Invitation:' })
  ).toContainText('Invitation: person');
});

test('shows agent computer status and supports retry and removal through the row menu', async ({
  page,
}) => {
  await page.goto('/?members');
  await expect(page.getByText('Agent', { exact: true })).toHaveCount(3);
  await expect(page.getByText('Starting computer (2/5)')).toHaveCount(0);
  await expect(page.getByText('Creating computer (2/5)')).toBeVisible();
  await expect(
    page.getByText('Included for Macro', { exact: true })
  ).toBeVisible();
  const menus = page.getByRole('button', { name: 'More', exact: true });
  await menus.nth(2).click();
  await page.getByRole('menuitem', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Invitation:' })
  ).toContainText('Retries: 1');
  await menus.nth(2).click();
  await page
    .getByRole('menuitem', { name: 'Remove agent', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Invitation:' })
  ).toContainText('Removals: 1');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth
  );
  expect(overflow).toBe(false);
});
