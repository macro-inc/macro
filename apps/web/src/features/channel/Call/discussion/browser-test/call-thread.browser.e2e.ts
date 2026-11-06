import { mkdir } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';

const CHANNEL_ID = '00000000-0000-7000-8000-00000000c0c0';
const CALL_ID = '00000000-0000-7000-8000-0000000ca110';
const CALLER = 'macro|caller@example.com';
const STARTED_AT = new Date(Date.now() - 5 * 60_000).toISOString();
const PATH =
  '/src/features/channel/Call/discussion/browser-test/call-thread.html';

function message(id: string, content: string, overrides: object = {}) {
  return {
    id,
    parent: { type: 'channel', id: CHANNEL_ID },
    thread_id: null,
    kind: 'message',
    sender_id: 'macro|member@example.com',
    mentions: [],
    content,
    created_at: STARTED_AT,
    updated_at: STARTED_AT,
    attachments: [],
    reactions: [],
    ...overrides,
  };
}

function listItem(
  body: ReturnType<typeof message>,
  replies: ReturnType<typeof message>[]
) {
  return {
    ...body,
    state: {
      root_id: body.id,
      user_id: body.sender_id,
      resolved: false,
      anchor: null,
      created_at: body.created_at,
      updated_at: body.created_at,
    },
    thread: {
      reply_count: replies.length,
      latest_reply_at: replies.at(-1)?.created_at ?? null,
      preview: replies.slice(0, 3),
    },
  };
}

const reply = (id: string, content: string) =>
  message(id, content, {
    thread_id: CALL_ID,
    created_at: new Date(Date.parse(STARTED_AT) + 60_000).toISOString(),
  });

const root = message(CALL_ID, 'started a call', {
  kind: 'call_root',
  sender_id: CALLER,
});
const earlier = message(
  '00000000-0000-7000-8000-000000000e01',
  'Earlier in the channel',
  { created_at: new Date(Date.parse(STARTED_AT) - 60_000).toISOString() }
);
const after = message(
  '00000000-0000-7000-8000-000000000a01',
  'Posted outside the call',
  { created_at: new Date(Date.now() + 60_000).toISOString() }
);

type Scenario = {
  status: object;
  replies?: ReturnType<typeof message>[];
  outside?: boolean;
  shell?: 'docked' | 'overlay';
  historyCount?: number;
};

async function open(
  page: Page,
  view: 'messages' | 'panel',
  scenario: Scenario
) {
  const replies = scenario.replies ?? [];
  const posted: unknown[] = [];
  const entries = [
    ...(scenario.outside
      ? [{ type: 'message', message: listItem(after, []) }]
      : []),
    {
      type: 'call',
      message: listItem(root, replies),
      status: scenario.status,
    },
    ...Array.from({ length: scenario.historyCount ?? 1 }, (_, index) => ({
      type: 'message',
      message: listItem(
        index === 0
          ? earlier
          : message(
              `00000000-0000-7000-8000-${(0xe01 + index).toString(16).padStart(12, '0')}`,
              `Older channel message ${index}`,
              {
                created_at: new Date(
                  Date.parse(STARTED_AT) - (index + 1) * 60_000
                ).toISOString(),
              }
            ),
        []
      ),
    })),
  ];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/timeline')) {
      await route.fulfill({
        json: { entries, next_cursor: null, previous_cursor: null },
      });
    } else if (url.pathname.includes(`/threads/${CALL_ID}`)) {
      await route.fulfill({
        json: {
          root,
          state: listItem(root, replies).state,
          replies,
        },
      });
    } else if (
      url.pathname.endsWith(`/messages/channel/${CHANNEL_ID}`) &&
      request.method() === 'POST'
    ) {
      const body = request.postDataJSON();
      posted.push(body);
      await route.fulfill({
        json: message(body.id ?? 'posted', body.content, {
          thread_id: body.thread_id ?? null,
        }),
      });
    } else if (url.pathname.endsWith(`/call/${CHANNEL_ID}/active`)) {
      await route.fulfill({
        json:
          'state' in scenario.status && scenario.status.state === 'live'
            ? {
                callId: CALL_ID,
                channelId: CHANNEL_ID,
                createdBy: CALLER,
                createdAt: STARTED_AT,
              }
            : null,
      });
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
  await page.goto(`${PATH}?view=${view}&shell=${scenario.shell ?? ''}`);
  return { posted, replies };
}

const callRow = (page: Page) =>
  page.locator(`[data-message-id="${CALL_ID}"]`).first();

test('a live call is a row with its thread collapsed under it and a way in', async ({
  page,
}, testInfo) => {
  await open(page, 'messages', {
    status: { state: 'live' },
    replies: [reply('00000000-0000-7000-8000-000000000b01', 'First reply')],
  });

  await expect(callRow(page)).toContainText('started a call', {
    timeout: 30_000,
  });
  await expect(
    callRow(page).getByRole('button', { name: 'Join' })
  ).toBeVisible();
  await expect(page.getByText('First reply')).toHaveCount(0);
  // Touch replies through the one floating composer rather than under the row.
  if (testInfo.project.name === 'desktop') {
    await expect(
      page.locator('[data-input-id^="thread-reply-input"]')
    ).toHaveCount(1);
  }

  await page.getByRole('button', { name: /1 reply/ }).click();
  await expect(page.getByText('First reply')).toBeVisible();
});

test('an ended call says how long it lasted and offers no way in', async ({
  page,
}) => {
  await open(page, 'messages', {
    status: {
      state: 'ended',
      ended_at: new Date().toISOString(),
      duration_ms: 38 * 60_000,
    },
  });

  await expect(callRow(page)).toContainText(
    'started a call that lasted 38 minutes',
    {
      timeout: 30_000,
    }
  );
  await expect(callRow(page).getByRole('button', { name: 'Join' })).toHaveCount(
    0
  );
});

test('the panel opens on a blank slate, with the channel above and nothing newer', async ({
  page,
}) => {
  await open(page, 'panel', { status: { state: 'live' }, outside: true });

  await expect(
    page.getByText('Start the conversation.', { exact: true })
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Posted outside the call')).toHaveCount(0);

  // The call's row starts the view: the channel above it is out of sight.
  const list = await page.getByTestId('call-panel').boundingBox();
  const row = await callRow(page).boundingBox();
  expect(row && list && row.y - list.y).toBeLessThan(120);
  await expect(page.getByText('Earlier in the channel')).not.toBeInViewport();
});

test('sending from the panel replies in the call thread, never to the channel', async ({
  page,
}, testInfo) => {
  // The touch composer starts collapsed; its own suite covers opening it.
  test.skip(testInfo.project.name === 'phone');
  const { posted } = await open(page, 'panel', { status: { state: 'live' } });

  await expect(page.getByText('Replying in the call thread')).toHaveCount(0);
  const composer = page.locator('[data-markdown-editable]');
  await composer.click();
  await page.keyboard.type('From the call');
  await page.getByRole('button', { name: /send/i }).click();

  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ thread_id: CALL_ID });

  // The composer stays on the call thread, empty and ready for the next one.
  await expect(page.getByText('Replying in the call thread')).toHaveCount(0);
  await expect(composer).toHaveText('');
});

test('a thread with messages opens at the newest, and a reply quotes in place', async ({
  page,
}, testInfo) => {
  // Reply is a hover action here and a long-press drawer on touch.
  test.skip(testInfo.project.name === 'phone');
  const { posted } = await open(page, 'panel', {
    status: { state: 'live' },
    replies: Array.from({ length: 40 }, (_, index) =>
      reply(
        `00000000-0000-7000-8000-0000000b00${(10 + index).toString()}`,
        `Message ${index + 1}`
      )
    ),
  });

  const newest = page.getByText('Message 40', { exact: true });
  await expect(newest).toBeInViewport({ timeout: 30_000 });
  await expect(callRow(page)).not.toBeInViewport();

  await newest.hover();
  await page
    .getByRole('button', { name: 'Reply', exact: true })
    .first()
    .click();
  await page.keyboard.type('Agreed');
  await page.getByRole('button', { name: /send/i }).click();

  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ thread_id: CALL_ID });
  expect(JSON.stringify(posted[0])).toContain('m-reply-target');
});

test('dismissing an explicit reply returns to the unflagged call-thread composer', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'phone');
  const { posted } = await open(page, 'panel', {
    status: { state: 'live' },
    replies: [reply('00000000-0000-7000-8000-000000000b01', 'A call message')],
  });
  const message = page.getByText('A call message', { exact: true });
  await expect(message).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Replying in the call thread')).toHaveCount(0);
  await message.hover();
  await page
    .getByRole('button', { name: 'Reply', exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Stop replying', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Stop replying', exact: true })
  ).toHaveCount(0);
  await expect(page.getByText('Replying in the call thread')).toHaveCount(0);
  await page.locator('[data-markdown-editable]').click();
  await page.keyboard.type('Back in the call');
  await page.getByRole('button', { name: /send/i }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ thread_id: CALL_ID });
});

test('scrolling up through the channel stays put', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'phone');
  await open(page, 'panel', { status: { state: 'live' } });
  await expect(
    page.getByText('Start the conversation.', { exact: true })
  ).toBeVisible({
    timeout: 30_000,
  });

  await page.getByTestId('call-panel').hover({ force: true });
  await page.mouse.wheel(0, -300);
  const earlierInChannel = page.getByText('Earlier in the channel');
  await expect(earlierInChannel).toBeInViewport();

  // Long enough for anything that pulls the list back down to have done so.
  await page.waitForTimeout(1_500);
  await expect(earlierInChannel).toBeInViewport();
});

test('the popup counts outside messages and swaps to the channel at the latest', async ({
  page,
}) => {
  await open(page, 'panel', { status: { state: 'live' }, outside: true });

  const popup = page.getByRole('button', {
    name: /sent a message in the channel/,
  });
  await expect(popup).toBeVisible({ timeout: 30_000 });

  await popup.click();

  await expect(page.getByTestId('messages-tab')).toBeVisible();
  await expect(page.getByText('Posted outside the call')).toBeInViewport();
});

for (const shell of ['docked', 'overlay'] as const) {
  for (const withMessages of [false, true]) {
    test(`composer stays at the bottom: ${shell}, messages=${withMessages}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name === 'phone' && shell === 'docked');
      await open(page, 'panel', {
        status: { state: 'live' },
        shell,
        historyCount: 40,
        replies: withMessages
          ? [reply('00000000-0000-7000-8000-000000000b01', 'A call message')]
          : [],
      });
      await expect(
        page.locator('[data-input-id^="thread-reply-input"]')
      ).toBeVisible({
        timeout: 30_000,
      });
      const panel = page.getByRole(
        testInfo.project.name === 'phone' ? 'dialog' : 'complementary',
        { name: 'Call sidebar' }
      );
      const composer = page.locator('[data-input-id^="thread-reply-input"]');
      const phase = process.env.CALL_REPRO_PHASE ?? 'after';
      const directory = process.env.CALL_REPRO_DIR;
      if (directory) {
        await mkdir(directory, { recursive: true });
        const path = `${directory}/L-77-${testInfo.project.name}-${shell}-${withMessages ? 'messages' : 'empty'}-${phase}.png`;
        await page.screenshot({ path });
        await testInfo.attach('Composer placement', {
          path,
          contentType: 'image/png',
        });
      }
      async function expectBottom() {
        const panelBox = await panel.boundingBox();
        const composerBox = await composer.boundingBox();
        expect(panelBox).not.toBeNull();
        expect(composerBox).not.toBeNull();
        expect(
          panelBox!.y + panelBox!.height - composerBox!.y - composerBox!.height
        ).toBeLessThanOrEqual(testInfo.project.name === 'phone' ? 32 : 24);
      }
      await expectBottom();
      await page.getByText(/^(People|Participants)( \d+)?$/).click();
      await expect(
        page.getByText('Call participant', { exact: true })
      ).toBeVisible();
      await page.getByText('Chat', { exact: true }).click();
      await expectBottom();
      if (testInfo.project.name === 'desktop') {
        await page.getByRole('button', { name: 'Leave call view' }).click();
        await page.getByRole('button', { name: 'Return to call view' }).click();
        await expectBottom();
      }
    });
  }
}

for (const readingHistory of [false, true]) {
  test(`call discussion keeps its scroll across tabs: history=${readingHistory}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'phone');
    const { posted, replies } = await open(page, 'panel', {
      status: { state: 'live' },
      shell: 'docked',
      historyCount: 40,
      replies: Array.from({ length: 40 }, (_, index) =>
        reply(
          `00000000-0000-7000-8000-0000000b00${10 + index}`,
          `Message ${index + 1}`
        )
      ),
    });
    const latest = page.getByText('Message 40', { exact: true });
    await expect(latest).toBeInViewport({ timeout: 30_000 });
    const editor = page.locator('[data-markdown-editable]');
    await editor.fill('Draft in the call');
    const scroll = page.locator('[data-channel-scroll]');
    if (readingHistory) {
      await scroll.hover();
      await page.mouse.wheel(0, -300);
      await expect(latest).not.toBeInViewport();
    }
    const previous = await scroll.evaluate((el) => el.scrollTop);
    await page.getByText(/^(People|Participants)$/).click();
    await expect(
      page.getByText('Call participant', { exact: true })
    ).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    replies.push(reply('00000000-0000-7000-8000-0000000b0050', 'Message 41'));
    const response = page.waitForResponse((response) =>
      response.url().includes(`/threads/${CALL_ID}`)
    );
    await page.getByRole('button', { name: 'Refresh discussion' }).click();
    await response;
    await page.getByText('Chat', { exact: true }).click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    const directory = process.env.CALL_REPRO_DIR;
    if (directory) {
      await mkdir(directory, { recursive: true });
      const path = `${directory}/L-78-${readingHistory ? 'history' : 'latest'}-${process.env.CALL_REPRO_PHASE ?? 'after'}.png`;
      await page.screenshot({ path });
      await testInfo.attach('Discussion after tab switch', {
        path,
        contentType: 'image/png',
      });
    }
    const current = await scroll.evaluate((el) => el.scrollTop);
    console.log(JSON.stringify({ readingHistory, previous, current }));
    if (readingHistory) expect(Math.abs(current - previous)).toBeLessThan(2);
    else
      await expect(
        page.getByText('Message 41', { exact: true })
      ).toBeInViewport();
    await expect(editor).toHaveText('Draft in the call');
    await page.getByRole('button', { name: /send/i }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ thread_id: CALL_ID });
  });
}
