import { expect, test } from '@playwright/test';

// This mounts the real controller, task adapter, reference reader and property
// controls; contacts transport is synthetic and Quick Access has no such users.
test('resolves off-window assignees through empty continuations and blocks ambiguous names', async ({
  page,
}) => {
  await page.goto('/?classification=task&task-references');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  const submit = page.getByRole('button', { name: 'Create task', exact: true });
  await input.fill('Assign task to Off Window');
  await expect(page.getByTestId('task-reference-values')).toContainText(
    'macro|person99999@example.com'
  );
  await expect(page.getByTestId('task-reference-pages')).toHaveText('2');
  await expect(submit).toBeEnabled();

  await input.fill('Assign task to Shared');
  await expect(page.getByTestId('task-reference-values')).toContainText(
    '"unresolved":["Assignees"]'
  );
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Clear inferred assignees' }).click();
  await expect(page.getByTestId('task-reference-values')).toContainText(
    '"refs":[]'
  );
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
});

test('leaves offline evidence unresolved and recovers without changing the task on reconnect', async ({
  page,
  context,
}) => {
  await page.goto('/?classification=task&task-references');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  const submit = page.getByRole('button', { name: 'Create task', exact: true });
  await input.fill('Assign task to Shared');
  await expect(page.getByTestId('task-reference-pages')).toHaveText('2');
  await context.setOffline(true);
  await input.fill('Assign task to Off Window');
  await expect(page.getByTestId('task-reference-input')).toContainText(
    'Off Window'
  );
  await expect(page.getByTestId('task-reference-values')).toContainText(
    '"unresolved":["Assignees"]'
  );
  await expect(submit).toBeDisabled();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('task-reference-values')).toContainText(
    'macro|person99999@example.com'
  );
  await expect(submit).toBeEnabled();
});
