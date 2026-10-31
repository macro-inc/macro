import { expect, test } from '@playwright/test';

test('an inbox rejection survives reload and restores the saved message without cancellation HTTP', async ({
  page,
  context,
}) => {
  let requests = 0;
  await context.route('**/test-email/*', async (route) => {
    requests++;
    expect(route.request().url()).toContain('/submit');
    await route.fulfill({ status: 403, json: {} });
  });
  await page.goto('/outbox.html');
  await page.getByRole('button', { name: 'Send frozen message' }).click();
  await expect(
    page.getByRole('button', { name: 'Restore draft' })
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Restore draft' })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await expect(page.getByTestId('restored')).toHaveText('Frozen message');
  await expect(page.getByTestId('rows')).toHaveText('[]');
  await expect(page.getByTestId('error')).toHaveText('');
  expect(requests).toBe(1);
});

test('offline approval survives reload and account changes, then reconciles lost acceptance without resending', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let submissions = 0;
  let checks = 0;
  let accepted: object | null = null;
  await context.route('**/test-email/*', async (route) => {
    const input = route.request().postDataJSON();
    if (route.request().url().endsWith('/submit')) {
      submissions++;
      expect(input.message.bodyText).toBe('Frozen message');
      accepted = {
        attemptId: input.attempt.attemptId,
        status: 'ACCEPTED',
        message: null,
        threadId: 'thread',
        sendTime: null,
      };
      await route.abort('failed'); // Commit succeeded; HTTP response was lost.
    } else {
      checks++;
      await route.fulfill({ json: accepted });
    }
  });
  await page.goto('/outbox.html');
  await expect(
    page.getByRole('button', { name: 'Send frozen message' })
  ).toBeEnabled();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Send frozen message' }).click();
  await expect(page.getByTestId('rows')).toContainText('Frozen message');
  expect(submissions).toBe(0);
  await page.getByRole('button', { name: 'Switch account' }).click();
  await expect(page.getByTestId('rows')).toHaveText('[]');
  await page.getByRole('button', { name: 'Return to owner' }).click();
  await expect(page.getByTestId('rows')).toContainText('Frozen message');
  // Reload with the browser online, retaining the actual IndexedDB intent.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByTestId('rows')).toContainText('"phase":"committed"', {
    timeout: 15_000,
  });
  expect(submissions).toBe(1);
  expect(checks).toBeGreaterThan(0);
  await expect(page.getByTestId('error')).toHaveText('');
  expect(errors).toEqual([]);
});
