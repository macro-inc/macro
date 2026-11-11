import { type BrowserContext, expect, type Page, test } from '@playwright/test';

const CALL = '00000000-0000-7000-8000-0000000ca110';
const GUEST_MESSAGE = '00000000-0000-7000-8000-0000000a0001';
const MEMBER = 'macro|me@example.com';
const GUEST = 'guest:guest-1';
const OPAQUE = 'participant:00000000-0000-5000-8000-000000000001';
const PATH = '/src/features/channel/Call/chat/browser-test/call-chat.html';
const LINK = 'https://example.com/shared-page';

type Message = ReturnType<typeof makeMessage>;
function makeMessage(id: string, sender: string, content: string) {
  const now = new Date().toISOString();
  return {
    id,
    parent: { type: 'call', id: CALL },
    thread_id: id === CALL ? null : CALL,
    kind: 'message',
    sender_id: sender,
    guest_name: sender === GUEST ? 'Casey' : null,
    imported_author: null as { name: string } | null,
    mentions: [],
    content,
    created_at: now,
    updated_at: now,
    attachments: [],
    reactions: [] as {
      emoji: string;
      users: string[];
      names?: Record<string, string>;
    }[],
    deleted_at: null as string | null,
    edited_at: null as string | null,
  };
}

function fakeServer(context: BrowserContext, messages: Message[]) {
  const requests: string[] = [];
  const errors: string[] = [];
  const guestView = (item: Message) => ({
    ...item,
    content: item.content.includes('<m-reply-target>')
      ? item.content.replaceAll(MEMBER, OPAQUE)
      : item.content,
    sender_id: item.sender_id === MEMBER ? OPAQUE : item.sender_id,
    imported_author: item.sender_id === MEMBER ? { name: 'Morgan' } : null,
    mentions: [],
    attachments: [],
    reactions: item.reactions.map((reaction) => ({
      ...reaction,
      users: reaction.users.map((id) => (id === MEMBER ? OPAQUE : id)),
      names: reaction.users.includes(MEMBER)
        ? { [OPAQUE]: 'Morgan' }
        : undefined,
    })),
  });
  const thread = (guest: boolean) => {
    const [root, ...replies] = messages;
    if (!root) return null;
    const project = guest ? guestView : (item: Message) => item;
    return {
      root: project(root),
      replies: replies.map(project),
      state: {
        root_id: CALL,
        user_id: guest && root.sender_id === MEMBER ? OPAQUE : root.sender_id,
        resolved: false,
        anchor: null,
        created_at: root.created_at,
        updated_at: root.updated_at,
      },
    };
  };
  const ready = context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/__macro_dev\/gateway\/dss/, '');
    const guest = path.startsWith(`/call/guest-chat/${CALL}/`);
    const member = path.startsWith(`/messages/call/${CALL}`);
    if (guest || member) {
      requests.push(decodeURIComponent(request.url()));
      if (guest)
        expect(request.headers().authorization).toBe(
          'Bearer fixture-guest-token'
        );
      if (
        request.method() === 'GET' &&
        (path.endsWith('/thread') || path.endsWith(`/threads/${CALL}`))
      ) {
        const data = thread(guest);
        if (guest)
          await route.fulfill({ json: { viewer_id: GUEST, thread: data } });
        else if (data) await route.fulfill({ json: data });
        else await route.fulfill({ status: 404, json: {} });
        return;
      }
      if (
        request.method() === 'POST' &&
        (path.endsWith('/messages') || path.endsWith(`/messages/call/${CALL}`))
      ) {
        const body = request.postDataJSON() as { id: string; content: string };
        const item = makeMessage(
          messages.length ? body.id : CALL,
          guest ? GUEST : MEMBER,
          guest ? body.content.replaceAll(OPAQUE, MEMBER) : body.content
        );
        messages.push(item);
        await route.fulfill({ json: guest ? guestView(item) : item });
        return;
      }
      const id = path.match(
        /(?:messages|items)\/([^/]+)(?:\/reactions)?$/
      )?.[1];
      const item = messages.find((message) => message.id === id);
      if (item && path.endsWith('/reactions') && request.method() === 'POST') {
        const body = request.postDataJSON() as { emoji: string; add: boolean };
        const actor = guest ? GUEST : MEMBER;
        const reaction = item.reactions.find(
          (entry) => entry.emoji === body.emoji
        );
        if (body.add && reaction && !reaction.users.includes(actor))
          reaction.users.push(actor);
        if (body.add && !reaction)
          item.reactions.push({ emoji: body.emoji, users: [actor] });
        if (!body.add && reaction) {
          reaction.users = reaction.users.filter((user) => user !== actor);
          item.reactions = item.reactions.filter(
            (entry) => entry.users.length > 0
          );
        }
        await route.fulfill({ json: guest ? guestView(item) : item });
        return;
      }
      if (
        item &&
        guest &&
        item.sender_id !== GUEST &&
        ['PATCH', 'DELETE'].includes(request.method())
      ) {
        await route.fulfill({ status: 403, json: {} });
        return;
      }
      if (item && request.method() === 'PATCH') {
        const content = (request.postDataJSON() as { content: string }).content;
        item.content = guest ? content.replaceAll(OPAQUE, MEMBER) : content;
        item.edited_at = new Date().toISOString();
        item.updated_at = item.edited_at;
        await route.fulfill({ json: guest ? guestView(item) : item });
        return;
      }
      if (item && request.method() === 'DELETE') {
        item.deleted_at = new Date().toISOString();
        item.content = '';
        await route.fulfill(guest ? { status: 204, body: '' } : { json: item });
        return;
      }
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.continue();
      return;
    }
    requests.push(decodeURIComponent(request.url()));
    await route.fulfill({ status: 404, json: {} });
  });
  const sockets = context.routeWebSocket('**/*', (socket) => socket.close());
  return { messages, requests, errors, ready: Promise.all([ready, sockets]) };
}

async function open(page: Page, access: 'guest' | 'member', errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${PATH}?access=${access}`);
  const chat = page.getByTestId('call-chat');
  await expect(chat.locator('[data-message-id]').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(chat.getByText('Loading chat…')).toHaveCount(0);
  return chat;
}

async function send(page: Page, content: string) {
  const chat = page.getByTestId('call-chat');
  await chat.locator('[contenteditable="true"]').last().click();
  await page.keyboard.type(content);
  await chat.getByRole('button', { name: /send/i }).click();
}

async function action(page: Page, id: string, name: string) {
  const row = page.locator(`[data-message-id="${id}"]`).first();
  if (await page.evaluate(() => 'ontouchstart' in window)) {
    await row.evaluate((element) => {
      const touch = new Touch({
        identifier: 1,
        target: element,
        clientX: 20,
        clientY: 20,
      });
      element.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
        })
      );
    });
    const drawer = page.getByRole('dialog', { name: 'Message actions' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name, exact: true }).click();
    await row.dispatchEvent('touchend', {
      bubbles: true,
      touches: [],
      changedTouches: [],
    });
    return;
  }
  await row.hover({ force: true });
  await row.getByRole('button', { name, exact: true }).click({ force: true });
}

test('first member message renders on a meeting page without app providers', async ({
  context,
  page,
}) => {
  const fake = fakeServer(context, []);
  await fake.ready;
  page.on('pageerror', (error) => fake.errors.push(error.message));
  await page.goto(`${PATH}?access=member&surface=direct`);
  const chat = page.getByTestId('call-chat');
  await expect(chat.getByText(/Start the conversation/)).toBeVisible({
    timeout: 60_000,
  });

  await send(page, LINK);
  await expect.poll(() => fake.messages.length).toBe(1);
  await expect(chat.locator(`a[href="${LINK}"]`)).toBeVisible();
  await expect(chat.getByText('Loading chat…')).toHaveCount(0);
  expect(fake.errors).toEqual([]);
});

test('guest message renders for a member on a meeting page', async ({
  context,
  page,
}) => {
  const fake = fakeServer(context, [
    makeMessage(CALL, GUEST, 'Hello from the guest'),
    makeMessage(GUEST_MESSAGE, MEMBER, 'Welcome to the call'),
  ]);
  await fake.ready;
  page.on('pageerror', (error) => fake.errors.push(error.message));
  await page.goto(`${PATH}?access=member&surface=direct`);
  const chat = page.getByTestId('call-chat');

  await expect(chat.getByText('Hello from the guest')).toBeVisible({
    timeout: 60_000,
  });
  await expect(chat.getByText('Casey (Guest)')).toBeVisible();
  await expect(chat.getByText('Welcome to the call')).toBeVisible();
  await expect(chat.getByRole('alert')).toHaveCount(0);
  await expect(chat.getByText(/GlobalAppStateContext/)).toHaveCount(0);
  expect(fake.errors).toEqual([]);
});

test('guest and member render the same rows with redacted identity', async ({
  context,
  page,
}, testInfo) => {
  const fake = fakeServer(context, [
    makeMessage(CALL, MEMBER, 'Welcome to the call'),
    makeMessage(GUEST_MESSAGE, GUEST, 'Hello from Casey'),
  ]);
  await fake.ready;
  const guest = await open(page, 'guest', fake.errors);
  await expect(guest.locator('[data-message]')).toHaveCount(2);
  await expect(guest.getByText('Morgan')).toBeVisible();
  await expect(guest.getByText('Casey (Guest)')).toBeVisible();
  await expect(
    guest.locator(`[data-message-id="${CALL}"] [data-slot="avatar"] > span`)
  ).toHaveText('M');
  await page.screenshot({
    path: testInfo.outputPath('guest.png'),
    fullPage: true,
  });

  const memberPage = await context.newPage();
  const member = await open(memberPage, 'member', fake.errors);
  await expect(member.locator('[data-message]')).toHaveCount(2);
  await expect(member.getByText('Casey (Guest)')).toBeVisible();
  await memberPage.screenshot({
    path: testInfo.outputPath('member.png'),
    fullPage: true,
  });
  expect(fake.requests.some((request) => request.includes(OPAQUE))).toBe(false);
  expect(fake.errors).toEqual([]);
  await memberPage.close();
});

test('member chat renders messages on a meeting page without app providers', async ({
  context,
  page,
}) => {
  const fake = fakeServer(context, [
    makeMessage(CALL, MEMBER, 'Meeting discussion'),
  ]);
  await fake.ready;

  const chat = await open(page, 'member', fake.errors);
  await expect(chat.locator(`[data-message-id="${CALL}"]`)).toContainText(
    'Meeting discussion'
  );
  expect(fake.errors).toEqual([]);
});

test('guest first post becomes the call root', async ({ context, page }) => {
  const fake = fakeServer(context, []);
  await fake.ready;
  page.on('pageerror', (error) => fake.errors.push(error.message));
  await page.goto(`${PATH}?access=guest`);
  await expect(page.getByText('Start the conversation.')).toBeVisible({
    timeout: 60_000,
  });
  await send(page, 'First call message');
  await expect(page.locator(`[data-message-id="${CALL}"]`)).toContainText(
    'First call message'
  );
  expect(fake.messages[0]?.id).toBe(CALL);
  expect(
    fake.requests.filter((request) =>
      /\/(bots|agents|user-names|messages\/call)\b/.test(request)
    )
  ).toEqual([]);
  expect(fake.errors).toEqual([]);
});

test('guest changes appear to member and ownership limits actions', async ({
  context,
  page,
}, testInfo) => {
  const fake = fakeServer(context, [
    makeMessage(CALL, MEMBER, 'Member message'),
    makeMessage(GUEST_MESSAGE, GUEST, 'Guest message'),
  ]);
  await fake.ready;
  const guest = await open(page, 'guest', fake.errors);
  const other = guest.locator(`[data-message-id="${CALL}"]`).first();
  if (await page.evaluate(() => 'ontouchstart' in window)) {
    await other.evaluate((element) => {
      const touch = new Touch({
        identifier: 1,
        target: element,
        clientX: 20,
        clientY: 20,
      });
      element.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
        })
      );
    });
    const drawer = page.getByRole('dialog', { name: 'Message actions' });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole('button', { name: 'Edit', exact: true })
    ).toHaveCount(0);
    await expect(
      drawer.getByRole('button', { name: 'Delete', exact: true })
    ).toHaveCount(0);
    await other.dispatchEvent('touchend', {
      bubbles: true,
      touches: [],
      changedTouches: [],
    });
    await page.keyboard.press('Escape');
  } else {
    await other.hover();
    await expect(
      other.getByRole('button', { name: 'Edit', exact: true })
    ).toHaveCount(0);
    await expect(
      other.getByRole('button', { name: 'Delete', exact: true })
    ).toHaveCount(0);
  }

  await action(page, CALL, 'Reply');
  await send(page, 'Quoted response');
  expect(fake.messages.at(-1)?.content).toContain('m-reply-target');
  expect(fake.messages.at(-1)?.content).toContain(MEMBER);
  expect(fake.messages.at(-1)?.content).not.toContain(OPAQUE);
  await expect(
    guest.getByRole('button', { name: /Replying to Morgan/ })
  ).toBeVisible();
  expect(
    fake.requests.filter((request) =>
      /\/(bots|agents|user-names|messages\/call)\b/.test(request)
    )
  ).toEqual([]);
  await action(page, CALL, 'React 👍');
  await expect(
    other.locator('[data-message-reaction-chip][data-emoji="👍"]')
  ).toBeVisible();
  await other.locator('[data-message-reaction-chip][data-emoji="👍"]').click();
  await expect(
    other.locator('[data-message-reaction-chip][data-emoji="👍"]')
  ).toHaveCount(0);

  await action(page, GUEST_MESSAGE, 'Edit');
  const threadReadsBeforeEdit = fake.requests.filter((request) =>
    request.endsWith('/thread')
  ).length;
  await guest
    .locator(`[data-message-id="${GUEST_MESSAGE}"] [contenteditable="true"]`)
    .fill('Edited guest message');
  await guest
    .locator(`[data-message-id="${GUEST_MESSAGE}"]`)
    .getByRole('button', { name: 'Send message' })
    .click();
  await expect
    .poll(
      () =>
        fake.messages.find((message) => message.id === GUEST_MESSAGE)?.content
    )
    .toBe('Edited guest message');
  await expect
    .poll(
      () =>
        fake.requests.filter((request) => request.endsWith('/thread')).length
    )
    .toBeGreaterThan(threadReadsBeforeEdit);
  await expect(
    guest.locator(`[data-message-id="${GUEST_MESSAGE}"]`)
  ).toContainText('Edited guest message');
  await action(page, GUEST_MESSAGE, 'React 👍');
  await expect(
    guest.locator(
      `[data-message-id="${GUEST_MESSAGE}"] [data-message-reaction-chip][data-emoji="👍"]`
    )
  ).toBeVisible();
  const memberPage = await context.newPage();
  const member = await open(memberPage, 'member', fake.errors);
  await expect(
    member.getByRole('button', { name: /Replying to/ })
  ).toBeVisible();
  await expect(
    member.getByRole('button', { name: /Replying to participant:/ })
  ).toHaveCount(0);
  await expect(
    member.locator(`[data-message-id="${GUEST_MESSAGE}"]`)
  ).toContainText('Edited guest message');
  await expect(
    member.locator(
      `[data-message-id="${GUEST_MESSAGE}"] [data-message-reaction-chip][data-emoji="👍"]`
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('guest-after-edit.png'),
    fullPage: true,
  });
  await memberPage.screenshot({
    path: testInfo.outputPath('member-after-edit.png'),
    fullPage: true,
  });

  await action(page, GUEST_MESSAGE, 'Delete');
  await page
    .getByRole('dialog', { name: /Delete message/i })
    .getByRole('button', { name: /delete/i })
    .click();
  await expect(
    guest.locator(`[data-message-id="${GUEST_MESSAGE}"]`)
  ).not.toContainText('Edited guest message');
  expect(fake.errors).toEqual([]);
  await memberPage.close();
});
