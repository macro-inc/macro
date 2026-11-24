import { expect, type Page, test } from '@playwright/test';

async function mockServices(page: Page) {
  // Never reach a real service; the composer reads only model catalogs.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: {} })
  );
  await page.route('**/agent-models/load', (route) => {
    const cursor = route.request().postDataJSON()?.harness === 'cursor';
    return route.fulfill({
      json: {
        status: 'available',
        currentModel: cursor ? 'cursor-default' : 'chat-default',
        models: cursor
          ? [{ id: 'cursor-default', name: 'Cursor Default' }]
          : [{ id: 'chat-default', name: 'Chat Default' }],
      },
    });
  });
  await page.route('**/agent-capabilities/discover', (route) =>
    route.fulfill({ json: { configOptions: [] } })
  );
}

async function mention(page: Page, search: string, name: string) {
  await page.keyboard.type(`@${search}`, { delay: 60 });
  await expect(page.getByText(new RegExp(`^${name}`)).first()).toBeVisible();
  await page.keyboard.press('Enter');
}

test('an @mentioned agent becomes the active agent and gets the prompt', async ({
  page,
}) => {
  await mockServices(page);
  await page.goto('/');
  await page.getByText('Chat', { exact: true }).click();
  const chat = page.getByRole('radio', { name: 'Chat' });
  const code = page.getByRole('radio', { name: 'Code' });
  await expect(chat).toHaveAttribute('data-checked');

  await page.getByRole('textbox').first().click();
  await mention(page, 'Cur', 'Cursor');
  await expect(code).toHaveAttribute('data-checked');
  await expect(
    page.getByRole('heading', { name: 'What should we build?' })
  ).toBeVisible();
  await page.keyboard.type('fix the flaky build', { delay: 30 });
  await page.screenshot({
    path: test.info().outputPath('cursor-selected.png'),
  });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByRole('region', { name: 'Started' }).getByText(/^Started Cursor:/)
  ).toBeVisible();

  await page.getByRole('textbox').first().click();
  await mention(page, 'Mac', 'Macro');
  await expect(chat).toHaveAttribute('data-checked');
  await page.keyboard.type('summarize my week', { delay: 30 });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByRole('region', { name: 'Started' }).getByText(/^Started Macro:/)
  ).toBeVisible();
});
