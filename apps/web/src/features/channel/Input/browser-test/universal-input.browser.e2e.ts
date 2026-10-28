import { expect, type Page, test } from '@playwright/test';

const INTENTS = [
  'ai',
  'search',
  'email',
  'note',
  'task',
  'calendar',
  'message',
] as const;

/** The classifier's seven independent scores, with one clear winner. */
function scores(top: (typeof INTENTS)[number]) {
  return INTENTS.map((intent) => ({
    intent,
    score: intent === top ? 0.93 : 0.04,
  }));
}

/**
 * Serves inference and blocks every other hosted request, so the composer runs
 * against nothing but the fixture.
 */
async function stubInference(page: Page, top: (typeof INTENTS)[number]) {
  // Playwright tries the most recently registered handler first, so the
  // catch-all goes down before the routes that must win over it.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ responses: [] }),
      });
  });
  // The task form reads the workspace's property catalog before extracting.
  // Matched by pattern, not glob: `definitions*` also catches the app's own
  // `queries/properties/definitions.ts` module request.
  await page.route(/\/properties\/definitions\?/, (route) =>
    route.fulfill({ json: [] })
  );
  await page.route('**/universal_input/classify', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: { revision: body.revision, scores: scores(top) },
    });
  });
  await page.route('**/universal_input/extract', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        revision: body.revision,
        intent: body.intent,
        suggestions: {
          title: 'Send the investor deck',
          body: null,
          due_date: null,
          properties: [],
        },
      },
    });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
}

async function openFixture(page: Page, top: (typeof INTENTS)[number]) {
  await stubInference(page, top);
  await page.goto(
    '/src/features/channel/Input/browser-test/universal-input.html'
  );
  const editor = page.locator('[data-markdown-editable]');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  return editor;
}

const badge = (page: Page) =>
  page.getByRole('button', { name: 'Creating a task?' });
const title = (page: Page) =>
  page.getByRole('textbox', { name: 'Title', exact: true });

test('a draft that reads as a task offers one, and Tab opens the form over the same text', async ({
  page,
}) => {
  const editor = await openFixture(page, 'task');
  await page.keyboard.type('remind me to send the investor deck tomorrow');
  await expect(badge(page)).toBeVisible({ timeout: 15_000 });
  await expect(editor).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(badge(page)).toHaveCount(0);
  await expect(title(page)).toHaveText('Send the investor deck');
  // The composer keeps the draft and the caret while the form reads it.
  await expect(editor).toHaveText(
    'remind me to send the investor deck tomorrow'
  );
  await expect(editor).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Create task', exact: true })
  ).toBeEnabled();

  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveCount(0);
  await expect(editor).toHaveText(
    'remind me to send the investor deck tomorrow'
  );
});

test('Tab still indents a list while nothing is offered', async ({ page }) => {
  const editor = await openFixture(page, 'message');
  await page.keyboard.type('- ship it');
  await expect(badge(page)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(editor.locator('ul ul li')).toHaveCount(1);
});

test('refusing the offer leaves the composer alone until the draft is cleared', async ({
  page,
}) => {
  const editor = await openFixture(page, 'task');
  await page.keyboard.type('remind me to send the investor deck tomorrow');
  await expect(badge(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dismiss suggestion' }).click();
  await expect(badge(page)).toHaveCount(0);
  await expect(editor).toBeFocused();

  await page.keyboard.type(' afternoon');
  await expect(badge(page)).toHaveCount(0);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('messages-sent')).toHaveText('1');
});

test('Enter still sends the draft as a message while the form is open', async ({
  page,
}) => {
  await openFixture(page, 'task');
  await page.keyboard.type('remind me to send the investor deck tomorrow');
  await expect(badge(page)).toBeVisible({ timeout: 15_000 });
  await badge(page).click();
  await expect(title(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('messages-sent')).toHaveText('1');
  // Sending empties the draft, so the form has nothing left to work on.
  await expect(title(page)).toHaveCount(0);
});
