import { expect, test } from '@playwright/test';

test('switching query state preserves reusable GraphQL documents', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Document integrity')).toHaveText(
    'Documents preserved'
  );
  for (const name of ['Channels', 'Home', 'Channels']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('Active operation')).toHaveText(
      name === 'Home' ? 'Soup' : 'ChannelListSoup'
    );
    await expect(page.getByLabel('Query result')).toHaveText('Loaded');
    await expect(page.getByLabel('Document integrity')).toHaveText(
      'Documents preserved'
    );
  }
});
