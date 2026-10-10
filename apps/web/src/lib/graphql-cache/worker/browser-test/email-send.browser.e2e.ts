import { expect, test } from '@playwright/test';

test('offline send survives cache reopen and is sent once after reconnect', async ({
  page,
  context,
}) => {
  const url = `/email-send.html?scope=send-${crypto.randomUUID()}`;
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Queued');
  await expect(page.locator('#body')).toBeDisabled();
  await expect(page.locator('#requests')).toHaveText('[]');
  await page.getByRole('button', { name: 'Close cache' }).click();
  await context.setOffline(false);
  await page.goto(url);
  await expect(page.locator('#status')).toHaveText('Accepted');
  await expect(page.locator('#requests')).toHaveText('["send"]');
});

test('offline cancel atomically removes an unattempted send', async ({
  page,
  context,
}) => {
  await page.goto(`/email-send.html?scope=cancel-${crypto.randomUUID()}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Queued');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Cancelled');
  await expect(page.locator('#body')).toBeEnabled();
  await expect(page.locator('#requests')).toHaveText('[]');
  await context.setOffline(false);
  await expect(page.locator('#requests')).toHaveText('["cancel"]');
});

test('two tabs racing offline sends acquire only one draft intent', async ({
  page,
  context,
}) => {
  const scope = `exclusive-${crypto.randomUUID()}`;
  const second = await context.newPage();
  await Promise.all([
    page.goto(`/email-send.html?scope=${scope}&attempt=${crypto.randomUUID()}`),
    second.goto(
      `/email-send.html?scope=${scope}&attempt=${crypto.randomUUID()}`
    ),
  ]);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(second.locator('html')).toHaveAttribute('data-ready', 'true');
  await context.setOffline(true);
  await Promise.all([
    page.getByRole('button', { name: 'Send', exact: true }).click(),
    second.getByRole('button', { name: 'Send', exact: true }).click(),
  ]);
  await expect
    .poll(
      async () =>
        (
          await Promise.all(
            [page, second].map((tab) => tab.locator('#error').textContent())
          )
        ).filter(Boolean).length
    )
    .toBe(1);
  for (const tab of [page, second]) {
    await expect(tab.locator('html')).toHaveAttribute('data-intent-count', '1');
    await expect(tab.locator('#body')).toBeDisabled();
    await expect(tab.locator('#requests')).toHaveText('[]');
  }
  const winner = (await page.locator('#error').textContent()) ? second : page;
  await winner.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(winner.locator('#status')).toHaveText('Cancelled');
  await context.setOffline(false);
  await expect
    .poll(async () =>
      (
        await Promise.all(
          [page, second].map((tab) => tab.locator('#requests').textContent())
        )
      ).flatMap((value) => JSON.parse(value ?? '[]'))
    )
    .toEqual(['cancel']);
});
