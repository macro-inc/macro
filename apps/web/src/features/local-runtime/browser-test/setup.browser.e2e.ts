import { expect, test } from '@playwright/test';

test('sets up the preferred agent and opens a session with it', async ({
  page,
}) => {
  await page.goto('/?scenario=happy');
  const dialog = page.getByRole('dialog', {
    name: 'Run agents on this computer',
  });
  await expect(dialog.getByText('Find an agent')).toBeVisible();
  await expect(dialog.getByText('@claude-code is ready')).toBeVisible();
  await expect(
    dialog.getByText('Sessions run in /Users/sample/Macro.')
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Start a session' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status', { name: 'Preview action' })).toHaveText(
    'Opened @claude-code'
  );
});

test('shows where setup is while it links the computer', async ({ page }) => {
  await page.goto('/?scenario=hold');
  const dialog = page.getByRole('dialog', {
    name: 'Run agents on this computer',
  });
  await expect(dialog.getByText('Found Claude Code')).toBeVisible();
  await expect(
    dialog.getByText('Linking this computer to your account…')
  ).toBeVisible();
  await expect(
    dialog.locator('li[aria-current="step"]', {
      hasText: 'Connect this computer',
    })
  ).toBeVisible();
});

test('recovers from a lost pairing with Try again', async ({ page }) => {
  await page.goto('/?scenario=fail-once');
  const dialog = page.getByRole('dialog', {
    name: 'Run agents on this computer',
  });
  await expect(
    dialog.getByText('The pairing code expired before it was approved.')
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByText('@claude-code is ready')).toBeVisible();
});

test('lets the user pick another agent before setting up', async ({ page }) => {
  await page.goto('/?scenario=happy&auto=false');
  const dialog = page.getByRole('dialog', {
    name: 'Run agents on this computer',
  });
  await expect(
    dialog.getByText('Found Claude Code on this computer.')
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Options' }).click();
  await expect(dialog.getByLabel('Workspace folder')).toHaveValue(
    '/Users/sample/Macro'
  );
  await expect(dialog.getByText('Full access')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Set up Claude Code' })
  ).toBeEnabled();
});

test('asks for an agent when none is installed', async ({ page }) => {
  await page.goto('/?scenario=none');
  const dialog = page.getByRole('dialog', {
    name: 'Run agents on this computer',
  });
  await expect(
    dialog.getByRole('button', { name: 'Scan again' })
  ).toBeVisible();
});
