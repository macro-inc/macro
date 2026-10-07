import { expect, test } from '@playwright/test';

const fixture = '/src/features/crm/browser-test/pipelines.html';

test('create a private company pipeline and customize a column', async ({
  page,
}) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New pipeline', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'Just me' })).toBeChecked();
  await dialog.getByRole('textbox', { name: 'Pipeline name' }).fill('Renewals');
  await dialog.getByRole('button', { name: 'Create pipeline' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Pipeline name' })
  ).toHaveValue('Renewals');
  await expect(
    page.getByRole('navigation', { name: 'CRM pipelines' })
  ).toContainText('Private');
  await page
    .getByRole('columnheader', { name: 'Company', exact: true })
    .press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Delete column' })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('columnheader', { name: 'Company', exact: true })
  ).toBeFocused();
  await page
    .getByRole('columnheader', { name: 'Stage', exact: true })
    .press('F2');
  await page.getByRole('textbox', { name: 'Column name' }).fill('Status');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('columnheader', { name: 'Status', exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Create requests')).toHaveText('1');
  await page.screenshot({ path: '/tmp/pipeline-ui.png' });
});

test('contact pipeline preserves choices after a failed create', async ({
  page,
}) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto(fixture, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Fail next create' }).click();
  await page.getByRole('button', { name: 'New pipeline', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Pipeline name' })
    .fill('Recruiting');
  await dialog.getByRole('radio', { name: 'Contacts', exact: true }).check();
  await dialog.getByRole('radio', { name: 'My team' }).check();
  await dialog.getByRole('button', { name: 'Create pipeline' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(
    dialog.getByRole('textbox', { name: 'Pipeline name' })
  ).toHaveValue('Recruiting');
  await expect(
    dialog.getByRole('radio', { name: 'Contacts', exact: true })
  ).toBeChecked();
  await dialog.getByRole('button', { name: 'Create pipeline' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Contact', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'CRM pipelines' })
  ).toContainText('Team');
});
