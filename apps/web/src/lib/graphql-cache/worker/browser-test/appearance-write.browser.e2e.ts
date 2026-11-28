import { expect, test } from '@playwright/test';

for (const count of [8, 16]) {
  test(`the committed appearance updates ${count} mounted Soup lists without a network read`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/appearance-write.html?lists=${count}&hold`);
    const lists = page.locator('#lists li');
    const requests = page.locator('#requests');
    await expect(lists.filter({ hasText: 'default' })).toHaveCount(count);
    await expect(requests).toHaveText('Soup reads 0 · GraphQL writes 0');
    await page.getByRole('button', { name: 'Save appearance' }).click();
    await expect(lists.filter({ hasText: 'green' })).toHaveCount(count);
    await page.getByRole('button', { name: 'Release server response' }).click();
    await expect(lists.filter({ hasText: 'teal' })).toHaveCount(count);
    await expect(lists.filter({ hasText: 'Shared note' })).toHaveCount(count);
    await expect(requests).toHaveText('Soup reads 0 · GraphQL writes 1');
    await page.screenshot({ path: testInfo.outputPath('committed.png') });
  });
}

test('replays a persisted offline appearance after the page reopens', async ({
  page,
}, testInfo) => {
  const scope = crypto.randomUUID();
  await page.goto(`/appearance-write.html?scope=${scope}&offline`);
  const lists = page.locator('#lists li');
  const requests = page.locator('#requests');
  await expect(lists.filter({ hasText: 'default' })).toHaveCount(8);
  await page.getByRole('button', { name: 'Save appearance' }).click();
  await expect(page.locator('#status')).toHaveText('queued');
  await expect(lists.filter({ hasText: 'green' })).toHaveCount(8);
  await expect(requests).toHaveText('Soup reads 0 · GraphQL writes 0');
  await page.screenshot({ path: testInfo.outputPath('queued.png') });

  await page.goto(`/appearance-write.html?scope=${scope}&replay`);
  await expect(page.locator('#status')).toHaveText('committed', {
    timeout: 45_000,
  });
  await expect(lists.filter({ hasText: 'teal' })).toHaveCount(8);
  await expect(requests).toHaveText('Soup reads 0 · GraphQL writes 1');
  await page.screenshot({ path: testInfo.outputPath('replayed.png') });
});

test('retries an offline save rejected by an older server schema', async ({
  page,
}) => {
  const scope = crypto.randomUUID();
  await page.goto(`/appearance-write.html?scope=${scope}&offline`);
  await expect(
    page.locator('#lists li').filter({ hasText: 'default' })
  ).toHaveCount(8);
  await page.getByRole('button', { name: 'Save appearance' }).click();
  await expect(page.locator('#status')).toHaveText('queued');

  await page.goto(`/appearance-write.html?scope=${scope}&replay&old-schema`);
  await expect(page.locator('#status')).toHaveText('committed', {
    timeout: 45_000,
  });
  await expect(
    page.locator('#lists li').filter({ hasText: 'teal' })
  ).toHaveCount(8);
  await expect(page.locator('#requests')).toHaveText(
    'Soup reads 0 · GraphQL writes 2'
  );
});

test('rolls back an offline save refused after reopening the page', async ({
  page,
}) => {
  const scope = crypto.randomUUID();
  await page.goto(`/appearance-write.html?scope=${scope}&offline`);
  const lists = page.locator('#lists li');
  await expect(lists.filter({ hasText: 'default' })).toHaveCount(8);
  await page.getByRole('button', { name: 'Save appearance' }).click();
  await expect(page.locator('#status')).toHaveText('queued');
  await expect(lists.filter({ hasText: 'green' })).toHaveCount(8);

  await page.goto(`/appearance-write.html?scope=${scope}&replay&forbidden`);
  await expect(page.locator('#status')).toHaveText('permanently-failed', {
    timeout: 45_000,
  });
  await expect(lists.filter({ hasText: 'default' })).toHaveCount(8);
  await expect(page.locator('#requests')).toHaveText(
    'Soup reads 0 · GraphQL writes 1'
  );
});
