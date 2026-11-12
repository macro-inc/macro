import { expect, type Page, test } from '@playwright/test';

const CALL_ID = '00000000-0000-7000-8000-0000000ca110';
const ME = 'macro|me@example.com';
const PATH = '/src/features/channel/Call/chat/browser-test/call-chat.html';
const LINK = 'https://example.com/shared-page';

type Stored = {
  id: string;
  parent: { type: 'call'; id: string };
  thread_id: string | null;
  kind: 'message';
  sender_id: string;
  guest_name?: string;
  mentions: unknown[];
  content: string;
  created_at: string;
  updated_at: string;
  attachments: unknown[];
  reactions: unknown[];
};

/** A call whose chat nobody has written in: the first post becomes its root. */
async function open(page: Page, guestThread = false) {
  const createdAt = new Date().toISOString();
  const messages: Stored[] = guestThread
    ? [
        {
          id: CALL_ID,
          parent: { type: 'call', id: CALL_ID },
          thread_id: null,
          kind: 'message',
          sender_id: 'guest-1',
          guest_name: 'Visitor',
          mentions: [],
          content: 'Hello from the guest',
          created_at: createdAt,
          updated_at: createdAt,
          attachments: [],
          reactions: [],
        },
        {
          id: '00000000-0000-7000-8000-0000000ca111',
          parent: { type: 'call', id: CALL_ID },
          thread_id: CALL_ID,
          kind: 'message',
          sender_id: ME,
          mentions: [],
          content: 'Welcome to the call',
          created_at: createdAt,
          updated_at: createdAt,
          attachments: [],
          reactions: [],
        },
      ]
    : [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith(`/messages/call/${CALL_ID}/threads/${CALL_ID}`)) {
      const [root, ...replies] = messages;
      if (!root) {
        await route.fulfill({ status: 404, json: {} });
        return;
      }
      await route.fulfill({
        json: {
          root,
          state: {
            root_id: root.id,
            user_id: root.sender_id,
            resolved: false,
            anchor: null,
            created_at: root.created_at,
            updated_at: root.created_at,
          },
          replies,
        },
      });
    } else if (
      url.pathname.endsWith(`/messages/call/${CALL_ID}`) &&
      request.method() === 'POST'
    ) {
      const body = request.postDataJSON();
      const now = new Date().toISOString();
      // The server gives the first message the call's id and threads the rest.
      const stored: Stored = {
        id: messages.length === 0 ? CALL_ID : body.id,
        parent: { type: 'call', id: CALL_ID },
        thread_id: messages.length === 0 ? null : CALL_ID,
        kind: 'message',
        sender_id: ME,
        mentions: [],
        content: body.content,
        created_at: now,
        updated_at: now,
        attachments: [],
        reactions: [],
      };
      messages.push(stored);
      await route.fulfill({ json: stored });
    } else if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      // The fixture reads nothing else; hosted data is never read or written.
      await route.fulfill({ status: 404, json: {} });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(PATH);
  return { messages, errors };
}

test('the first message sent on a meeting page shows in the call chat', async ({
  page,
}) => {
  const { messages, errors } = await open(page);
  const chat = page.getByTestId('call-chat');
  await expect(chat.getByText('Start the conversation.')).toBeVisible();

  const composer = chat.locator('[contenteditable="true"]');
  await composer.click();
  await page.keyboard.type(LINK);
  await chat.getByRole('button', { name: /send/i }).click();

  await expect.poll(() => messages.length).toBe(1);
  await expect(chat.locator(`a[href="${LINK}"]`)).toBeVisible();
  await expect(chat.getByText('Loading chat…')).toHaveCount(0);
  // A message that throws while rendering leaves the panel on its last state.
  expect(errors).toEqual([]);
});

test('a guest message renders on a signed-in meeting page', async ({
  page,
}) => {
  const { errors } = await open(page, true);
  const chat = page.getByTestId('call-chat');

  await expect(chat.getByText('Hello from the guest')).toBeVisible();
  await expect(chat.getByText('Visitor (Guest)')).toBeVisible();
  await expect(chat.getByText('Welcome to the call')).toBeVisible();
  await expect(chat.getByRole('alert')).toHaveCount(0);
  await expect(chat.getByText(/GlobalAppStateContext/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
