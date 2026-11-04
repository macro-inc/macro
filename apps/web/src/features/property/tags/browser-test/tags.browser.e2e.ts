import { expect, test } from '@playwright/test';

test('a sidebar tag applies on drag and still filters on click', async ({
  page,
}) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === 'localhost')
      await route.continue();
    else await route.fulfill({ status: 401, body: '{}' });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/src/features/property/tags/browser-test/tags.html');
  const tag = page.getByText('Urgent', { exact: true });
  await expect(tag).toBeVisible({ timeout: 60_000 });
  await tag.click();
  await expect(page.getByLabel('Filter')).toHaveText('urgent');
  const origin = await tag.boundingBox();
  const row = page.getByTestId('row');
  const destination = await row.boundingBox();
  if (!origin || !destination) throw new Error('Drag bounds missing');
  await page.mouse.move(
    origin.x + origin.width / 2,
    origin.y + origin.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2,
    { steps: 15 }
  );
  await expect(row).toHaveClass(/outline-2/);
  await page.mouse.up();
  await expect(page.getByLabel('Applied tags')).toHaveText('Existing, Urgent');
});
