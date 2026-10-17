import { expect, type Page, test } from '@playwright/test';

// The fixture imports app modules that open sockets and refresh tokens; keep
// every request on the fixture server.
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) =>
    route.abort()
  );
  await page.routeWebSocket(/^wss?:\/\/(?!127\.0\.0\.1[:/])/, (socket) =>
    socket.close()
  );
});

async function openThread(page: Page, search = '') {
  await page.goto(`/${search}`);
  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  await expect(
    page.getByText('Here is the invoice for September.')
  ).toBeVisible();
}

const editor = (page: Page) =>
  page.locator('[contenteditable="true"][role="textbox"]');

async function openReply(page: Page) {
  await page.keyboard.press('r');
  await expect(editor(page)).toBeFocused();
}

const inbox = (page: Page) => page.getByRole('region', { name: 'Inbox' });

const firstPressCases: [string, (page: Page) => Promise<void>][] = [
  [
    'after clicking inside the HTML body',
    (page) => page.getByText('Here is the invoice for September.').click(),
  ],
  [
    'after clicking an inline image',
    (page) => page.getByRole('img', { name: 'Company logo' }).click(),
  ],
  [
    'with a link in the body focused',
    (page) => page.getByRole('link', { name: 'View invoice' }).focus(),
  ],
  [
    'after selecting a message with the arrow keys',
    (page) => page.keyboard.press('ArrowUp'),
  ],
  [
    'with a reply open but focus back on the message',
    async (page) => {
      await openReply(page);
      await editor(page).pressSequentially('Draft in progress');
      await page.getByText('Here is the invoice for September.').click();
      await expect(editor(page)).not.toBeFocused();
    },
  ],
];

for (const [name, setup] of firstPressCases) {
  test(`one Escape returns to the list ${name}`, async ({ page }) => {
    await openThread(page);
    await setup(page);
    await page.keyboard.press('Escape');
    await expect(inbox(page)).toBeVisible();
    await expect(page.getByTestId('deleted-drafts')).toBeEmpty();
  });
}

const replyCases: [string, string, (page: Page) => Promise<void>][] = [
  ['an empty reply', '', openReply],
  [
    'a reply with text',
    '',
    async (page) => {
      await openReply(page);
      await editor(page).pressSequentially('See you Monday');
    },
  ],
  [
    'a saved draft the thread focused on open',
    '?draft',
    async (page) => {
      await expect(editor(page)).toBeFocused();
      await expect(editor(page)).toContainText('Saved reply');
    },
  ],
  [
    'a new forward with focus in To',
    '',
    async (page) => {
      await page.keyboard.press('f');
      await expect(page.getByRole('combobox').first()).toBeFocused();
    },
  ],
];

for (const [name, search, setup] of replyCases) {
  test(`Escape leaves ${name} for its message, then returns to the list`, async ({
    page,
  }) => {
    await openThread(page, search);
    await setup(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-message-body-id="last"]')).toBeFocused();
    await expect(editor(page)).toBeVisible();
    await expect(inbox(page)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(inbox(page)).toBeVisible();
    await expect(page.getByTestId('deleted-drafts')).toBeEmpty();
  });
}

test('a reply with text is still a draft after leaving the thread', async ({
  page,
}) => {
  await openThread(page);
  await openReply(page);
  await editor(page).pressSequentially('See you Monday');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toContainText('See you Monday');
  await page.keyboard.press('Escape');
  await expect(inbox(page)).toBeVisible();
  await expect(page.getByTestId('saved-drafts')).toContainText(
    'See you Monday'
  );
});

test('Escape closes the open send-time picker first, then returns to the list', async ({
  page,
}) => {
  await openThread(page);
  await openReply(page);
  await editor(page).pressSequentially('Later');
  const trigger = page.getByRole('button', { name: 'Choose send time' });
  await trigger.click();
  const search = page.getByRole('combobox');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(inbox(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(inbox(page)).toBeVisible();
});
