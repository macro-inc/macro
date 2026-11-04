import { expect, test } from '@playwright/test';

test('team onboarding caps same-domain prefill and preserves manual edits through source changes', async ({
  page,
}) => {
  await page.goto('/?onboarding-contacts&hold');
  await expect(page.getByTestId('onboarding-contact-count')).toHaveText('1');
  await expect(page.getByLabel('Workspace name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Release contact page' }).click();
  await expect(page.getByLabel('Workspace name')).toHaveValue('Team');
  await expect(page.getByLabel(/Teammate \d+ email/)).toHaveCount(7);
  await expect(
    page.getByLabel('Teammate 1 email', { exact: true })
  ).toHaveValue('member0@team.example.com');
  await expect(
    page.getByLabel('Teammate 6 email', { exact: true })
  ).toHaveValue('member5@team.example.com');
  await expect(page.getByTestId('onboarding-contact-count')).toHaveText('6');
  await expect(page.getByTestId('onboarding-contact-requests')).toContainText(
    '"search":"@team.example.com"'
  );
  await page.getByLabel('Workspace name').fill('Edited workspace');
  await page
    .getByRole('button', {
      name: "Don't invite member1@team.example.com",
      exact: true,
    })
    .click();
  await page
    .getByLabel('Teammate 1 email', { exact: true })
    .fill('chosen@example.com');
  await page.getByRole('button', { name: 'Refresh domain' }).click();
  await expect(page.getByTestId('onboarding-contact-count')).toHaveText('12');
  await expect(page.getByLabel('Workspace name')).toHaveValue(
    'Edited workspace'
  );
  await expect(
    page.getByLabel('Teammate 1 email', { exact: true })
  ).toHaveValue('chosen@example.com');
  await page.getByRole('button', { name: /Create team & invite/ }).click();
  await expect(page.getByTestId('onboarding-completed')).toHaveText('true');
  await expect(page.getByTestId('onboarding-calls')).toContainText(
    'chosen@example.com'
  );
  await expect(page.getByTestId('onboarding-calls')).not.toContainText(
    'member1@team.example.com'
  );
  await expect(page.getByTestId('onboarding-calls')).not.toContainText(
    'alias@other.example.com'
  );
  await expect(page.getByTestId('onboarding-calls')).not.toContainText(
    'VIEWER@team.example.com'
  );
});

test('a server-declined team domain does not read contacts', async ({
  page,
}) => {
  await page.goto('/?onboarding-contacts&no-domain');
  await expect(page.getByLabel('Workspace name')).toBeVisible();
  await expect(page.getByLabel(/Teammate \d+ email/)).toHaveCount(2);
  await expect(page.getByTestId('onboarding-contact-count')).toHaveText('0');
  await expect(page.getByTestId('onboarding-contact-requests')).toHaveText(
    '[]'
  );
});
