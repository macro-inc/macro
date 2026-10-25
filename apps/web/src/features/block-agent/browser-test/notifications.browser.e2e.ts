import { expect, test } from '@playwright/test';

test('response timing follows the decision turn across busy output and the first reply', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Decide', exact: true }).click();
  await expect(page.locator('.agent-working-wave')).toBeVisible();
  await page
    .locator('main')
    .screenshot({ path: test.info().outputPath('responding.png') });
  await page.getByRole('button', { name: 'Busy output' }).click();
  await expect(page.locator('.agent-working-wave')).toBeVisible();
  await page.getByRole('button', { name: 'Receive decision' }).click();
  await expect(page.locator('.agent-working-wave')).toBeVisible();
  await page.getByRole('button', { name: 'Agent reply' }).click();
  await expect(page.locator('.agent-working-wave')).toHaveCount(0);
  await expect(page.locator('[data-turn="1"]')).toHaveText(
    'Your review is complete.'
  );
});

test('request rejection and silent completion both clear the pending response', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Decide', exact: true }).click();
  await expect(page.locator('.agent-working-wave')).toBeVisible();
  await page.getByRole('button', { name: 'Reject request' }).click();
  await expect(page.locator('.agent-working-wave')).toHaveCount(0);
  await page.getByRole('button', { name: 'Decide', exact: true }).click();
  await page.getByRole('button', { name: 'Receive decision' }).click();
  await page.getByRole('button', { name: 'Silent completion' }).click();
  await expect(page.locator('.agent-working-wave')).toHaveCount(0);
  await expect(page.locator('[data-turn]')).toHaveCount(0);
});

test('typed event rows stay on one line and open their review subject', async ({
  page,
}) => {
  await page.goto('/');
  const rows = page
    .getByRole('region', { name: 'Session events' })
    .getByRole('status');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Notion workspace');
  await expect(rows.nth(1)).toContainText('You approved 1 item');
  await expect(rows.nth(2)).toContainText('1 failed');
  await expect(rows.nth(0).locator('svg')).toHaveCount(1);
  for (const row of await rows.all()) {
    expect(
      await row.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    const time = row.locator('time');
    await expect(time).toHaveAttribute('title', /.+/);
    await expect(time).toBeVisible();
  }
  const label = rows.nth(0).locator('.truncate').last();
  if (test.info().project.name === 'mobile') {
    await expect(page.locator('html')).toHaveAttribute(
      'data-touch-device',
      'true'
    );
    expect(
      await label.evaluate(
        (element) => element.scrollWidth > element.clientWidth
      )
    ).toBe(true);
  }
  await rows.nth(1).getByRole('button', { name: 'View review' }).click();
  await expect(page.getByLabel('Opened review')).toHaveText(
    '019a0000-0000-7000-8000-000000000005'
  );
  await page
    .getByRole('region', { name: 'Session events' })
    .screenshot({ path: test.info().outputPath('session-event-rows.png') });
});
