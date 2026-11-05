import { expect, test } from '@playwright/test';

test('an unhealthy agent can recover without provisioning retry', async ({
  page,
}) => {
  await page.goto('/?members&unhealthy');
  await expect(page.getByText('Unhealthy', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('note')).toHaveText(
    'Brain connection unavailable'
  );
  await expect(
    page.getByRole('menuitem', { name: 'Retry', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: 'Remove agent', exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Restore agent health', exact: true })
    .click();
  await expect(page.getByText('Unhealthy', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Brain connection unavailable', { exact: true })
  ).toHaveCount(0);
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Invitation:' })
  ).toContainText('Retries: 0');
});

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
  await expect(
    page.getByRole('progressbar', { name: 'Agent setup' })
  ).toHaveAttribute('aria-valuenow', '2');
  await expect(page.getByText('Billed', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Included for Macro', { exact: true })
  ).toHaveCount(0);
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

test('invitation menu supports keyboard navigation, dismissal and focus return', async ({
  page,
}) => {
  await page.goto('/?members');
  const options = page.getByRole('button', {
    name: 'Invite options',
    exact: true,
  });
  await options.focus();
  await page.keyboard.press('Enter');
  const person = page.getByRole('menuitem', {
    name: 'Invite a person',
    exact: true,
  });
  const agent = page.getByRole('menuitem', {
    name: 'Invite an agent',
    exact: true,
  });
  await expect(person).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(agent).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Invitation:' })
  ).toContainText('Invitation: agent');
  await expect(options).toBeFocused();
  await options.press('Enter');
  await page.keyboard.press('Escape');
  await expect(person).toHaveCount(0);
  await expect(options).toBeFocused();
});

for (const dismissal of ['Cancel', 'Escape']) {
  test(`restores menu trigger focus after ${dismissal} on its agent dialog`, async ({
    page,
  }) => {
    await page.goto('/?menu-dialog');
    const options = page.getByRole('button', {
      name: 'Invite options',
      exact: true,
    });
    await options.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: 'Invite a person', exact: true })
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('menuitem', { name: 'Invite an agent', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: 'Invite agent',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    if (dismissal === 'Cancel') {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(dialog).toHaveCount(0);
    await expect(options).toBeFocused();
  });
}
