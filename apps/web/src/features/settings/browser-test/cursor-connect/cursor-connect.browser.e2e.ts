import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, type TestInfo, test } from '@playwright/test';

/** Where to also copy every screenshot, for a PR; unset keeps them in test-results. */
const screenshotDirectory = process.env.CURSOR_CONNECT_SCREENSHOT_DIR;

/** A made-up key in Cursor's format; never a real one. */
const TEST_KEY = 'grok_test_0000000000000000';

type Backend = { registered: boolean; saved: string[] };

/** Scripts the Cursor key and model routes; other requests 404, pages load. */
async function scriptAuthService(page: Page): Promise<Backend> {
  const backend: Backend = { registered: false, saved: [] };
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!['fetch', 'xhr'].includes(request.resourceType()))
      return route.continue();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (path.endsWith('/agent-models/load'))
      return json({
        status: 'available',
        models: [{ id: 'auto', name: 'Auto' }],
      });
    if (path.endsWith('/cursor-api-key') && request.method() === 'PUT') {
      const body: { apiKey: string } = request.postDataJSON();
      backend.saved.push(body.apiKey);
      backend.registered = true;
      return json({
        registered: true,
        defaultModelId: null,
        defaultEffort: null,
        updatedAt: new Date().toISOString(),
      });
    }
    if (path.endsWith('/cursor-api-key'))
      return json({
        registered: backend.registered,
        defaultModelId: null,
        defaultEffort: null,
        updatedAt: backend.registered ? new Date().toISOString() : null,
      });
    return route.fulfill({ status: 404, body: '' });
  });
  return backend;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const file = `${testInfo.project.name}-${name}.png`;
  const path = testInfo.outputPath(file);
  await page.screenshot({ path });
  if (!screenshotDirectory) return;
  await mkdir(screenshotDirectory, { recursive: true });
  await copyFile(path, join(screenshotDirectory, file));
}

test('pasting a Cursor key: masked, revealable, saved', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page);
  await page.goto('/');

  const field = page.getByLabel('API key', { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'new-password');
  await expect(field).toHaveClass(/ph-no-capture/);
  await expect(field).toHaveAttribute('placeholder', 'grok_…');
  await screenshot(page, testInfo, 'empty');

  await field.fill(TEST_KEY);
  await expect(field).toHaveAttribute('type', 'password');
  await screenshot(page, testInfo, 'masked');

  await page.getByRole('button', { name: 'Show what you typed' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toBeFocused();
  await screenshot(page, testInfo, 'revealed');

  await page.getByRole('button', { name: 'Hide what you typed' }).click();
  await expect(field).toHaveAttribute('type', 'password');

  await field.press('Enter');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  expect(backend.saved).toEqual([TEST_KEY]);
  await expect(field).toHaveCount(0);
  await screenshot(page, testInfo, 'connected');
});
