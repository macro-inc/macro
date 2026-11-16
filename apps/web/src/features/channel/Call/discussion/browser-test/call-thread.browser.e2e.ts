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
const after = () =>
  message('00000000-0000-7000-8000-000000000a01', 'Posted outside the call', {
    created_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  });

type Scenario = {
  status: object;
  replies?: ReturnType<typeof message>[];
  outside?: boolean;
  shell?: 'docked' | 'overlay';
  historyCount?: number;
  fullOverlay?: boolean;
  work?: 'present' | 'empty' | 'off';
  chat?: 'on' | 'off';
  baseline?: boolean;
  unread?: boolean;
  theme?: string;
  headerWidth?: number;
};

async function open(
  page: Page,
  view: 'messages' | 'panel',
  scenario: Scenario
) {
  if (scenario.fullOverlay) {
    page.on('pageerror', (error) =>
      console.error('Fixture error:', error.stack)
    );
  }
  const replies = scenario.replies ?? [];
  const posted: unknown[] = [];
  const entries = [
    ...(scenario.outside
      ? [{ type: 'message', message: listItem(after(), []) }]
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
    if (url.pathname === '/fixture/work') {
      await route.fulfill({
        json: {
          data: {
            user: {
              registeredWork:
                scenario.work === 'present'
                  ? [
                      {
                        id: 'registration-1',
                        accountId: 'macro|member@example.com',
                        registeredAt: STARTED_AT,
                        session: {
                          id: '00000000-0000-7000-8000-00000000a001',
                          sessionName: 'Review the draft',
                          turnState: 'running',
                          pullRequestUrl: null,
                        },
                      },
                    ]
                  : [],
            },
          },
        },
      });
    } else if (url.pathname.endsWith('/timeline')) {
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
  const path = scenario.fullOverlay
    ? PATH.replace('call-thread.html', 'call-overlay.html')
    : PATH;
  await page.goto(
    `${path}?view=${view}&shell=${scenario.shell ?? ''}&work=${scenario.work ?? 'off'}&chat=${scenario.chat ?? 'on'}&baseline=${scenario.baseline ? 'main' : 'branch'}&unread=${scenario.unread ?? false}&theme=${scenario.theme ?? 'dark'}${scenario.headerWidth ? `&headerWidth=${scenario.headerWidth}` : ''}`
  );
  // Let the cold entry-module graph mount before timing an interaction.
  await page.getByRole('main').waitFor({ state: 'attached', timeout: 60_000 });
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
  await page.getByRole('button', { name: /1 reply/ }).click();
  await expect(page.getByText('First reply')).toBeVisible();
  // Touch replies through the one floating composer rather than under the row.
  if (testInfo.project.name === 'desktop') {
    await expect(page.locator('[data-markdown-editable]')).toHaveCount(1);
  }
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
  const { posted } = await open(page, 'panel', {
    status: { state: 'live' },
    fullOverlay: process.env.CALL_FULL_HOST === 'true',
  });

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
    fullOverlay: process.env.CALL_FULL_HOST === 'true',
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
    fullOverlay: process.env.CALL_FULL_HOST === 'true',
    replies: [reply('00000000-0000-7000-8000-000000000b01', 'A call message')],
  });
  const message = page.getByText('A call message', { exact: true });
  await expect(message).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Replying in the call thread')).toHaveCount(0);
  const editor = await page.locator('[data-markdown-editable]').elementHandle();
  await message.hover();
  await page
    .getByRole('button', { name: 'Reply', exact: true })
    .first()
    .click();
  if (process.env.CALL_REPRO_DIR)
    await page.screenshot({
      path: `${process.env.CALL_REPRO_DIR}/review-explicit-reply-${process.env.CALL_REPRO_PHASE ?? 'after'}.png`,
    });
  const dismiss = page.getByRole('button', {
    name: 'Stop replying',
    exact: true,
  });
  await expect(dismiss).toBeVisible();
  expect(await editor?.evaluate((element) => element.isConnected)).toBe(true);
  await dismiss.click();
  await expect(dismiss).toHaveCount(0);
  await expect(page.getByText('Replying in the call thread')).toHaveCount(0);
  expect(await editor?.evaluate((element) => element.isConnected)).toBe(true);
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
      const fullOverlay = process.env.CALL_FULL_HOST === 'true';
      if (
        fullOverlay &&
        shell === 'overlay' &&
        testInfo.project.name === 'desktop'
      )
        await page.setViewportSize({ width: 640, height: 860 });
      await open(page, 'panel', {
        status: { state: 'live' },
        fullOverlay,
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
        const gap =
          panelBox!.y + panelBox!.height - composerBox!.y - composerBox!.height;
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(
          testInfo.project.name === 'phone' ? 32 : 24
        );
      }
      await expectBottom();
      await page.getByText(/^Participants( \d+)?$/).click();
      await expect(
        page.getByRole('radio', { name: /^Participants/ })
      ).toBeChecked();
      await page.getByText('Chat', { exact: true }).click();
      await expectBottom();
      if (testInfo.project.name === 'desktop') {
        await page
          .getByRole('button', {
            name: fullOverlay
              ? 'Close chat and participants'
              : 'Leave call view',
          })
          .last()
          .click();
        await page
          .getByRole('button', {
            name: fullOverlay
              ? 'Open chat and participants'
              : 'Return to call view',
          })
          .click();
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
      fullOverlay: process.env.CALL_FULL_HOST === 'true',
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
    await page.getByText(/^Participants$/).click();
    await expect(
      page.getByRole('radio', { name: /^Participants/ })
    ).toBeChecked();
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
    await expect(page.getByText('Message 41', { exact: true })).toBeAttached();
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
    expect(JSON.stringify(posted[0])).toContain('Draft in the call');
  });
}

test('the participant tab keeps its name and phone count', async ({
  page,
}, testInfo) => {
  await open(page, 'panel', {
    status: { state: 'live' },
    shell: testInfo.project.name === 'phone' ? 'overlay' : 'docked',
  });
  await expect(page.getByRole('radio', { name: 'Chat' })).toBeVisible({
    timeout: 30_000,
  });
  const directory = process.env.CALL_REPRO_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    const path = `${directory}/L-80-${testInfo.project.name}-${process.env.CALL_REPRO_PHASE ?? 'after'}.png`;
    await page.screenshot({ path });
    await testInfo.attach('Participant tab label', {
      path,
      contentType: 'image/png',
    });
  }
  const name =
    testInfo.project.name === 'phone' ? 'Participants 2' : 'Participants';
  await expect(page.getByRole('radio', { name, exact: true })).toBeVisible();
  await page.getByText('Participants', { exact: true }).click();
  await expect(
    page.getByText('Call participant', { exact: true })
  ).toBeVisible();
});

for (const baseline of [false, true]) {
  for (const work of ['present', 'empty', 'off'] as const) {
    test(`registered work gating in the real call host: ${baseline ? 'main' : 'branch'} ${work}`, async ({
      page,
    }) => {
      test.skip(process.env.CALL_FULL_HOST !== 'true');
      await open(page, 'messages', {
        status: { state: 'live' },
        fullOverlay: true,
        work,
        baseline,
      });
      const prompt = page.getByRole('button', { name: 'View active work' });
      if (work === 'present') {
        await expect(prompt).toBeVisible({ timeout: 30_000 });
        const trigger = page.getByRole('button', {
          name: 'Open chat and participants',
        });
        await expect(trigger.locator('.bg-accent')).toBeVisible();
        if (process.env.CALL_REPRO_DIR)
          await page.screenshot({
            path: `${process.env.CALL_REPRO_DIR}/L-79-${baseline ? 'main' : 'branch'}-closed.png`,
          });
        await prompt.click();
        await expect(page.getByRole('radio', { name: 'Work' })).toBeChecked();
        await expect(
          page.getByText('Review the draft', { exact: true })
        ).toBeVisible();
      } else {
        await expect(
          page.getByRole('button', { name: 'Open chat and participants' })
        ).toBeVisible({ timeout: 30_000 });
        await expect(prompt).toHaveCount(0);
        await page
          .getByRole('button', { name: 'Open chat and participants' })
          .click();
        await expect(page.getByRole('radio', { name: 'Work' })).toHaveCount(0);
      }
      if (process.env.CALL_REPRO_DIR)
        await page.screenshot({
          path: `${process.env.CALL_REPRO_DIR}/L-79-${baseline ? 'main' : 'branch'}-${work}.png`,
        });
    });
  }
}

for (const width of [1280, 600]) {
  for (const theme of ['dark', 'light']) {
    test(`the real chat toggle has a 20px icon: ${width} ${theme}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name === 'phone');
      test.skip(process.env.CALL_FULL_HOST !== 'true');
      await page.setViewportSize({ width, height: 860 });
      await open(page, 'messages', {
        status: { state: 'live' },
        fullOverlay: true,
        unread: true,
        theme,
      });
      const button = page.getByRole('button', {
        name: 'Open chat and participants',
      });
      await expect(button).toBeVisible({ timeout: 30_000 });
      if (process.env.CALL_REPRO_DIR)
        await page.screenshot({
          path: `${process.env.CALL_REPRO_DIR}/L-81-${width}-${theme}-${process.env.CALL_REPRO_PHASE ?? 'after'}.png`,
        });
      const icon = button.locator('svg').first();
      const box = await icon.boundingBox();
      expect(box?.width).toBe(20);
      expect(box?.height).toBe(20);
      const frame = await button.boundingBox();
      const more = await page
        .getByRole('button', { name: 'More', exact: true })
        .boundingBox();
      expect(frame?.width).toBe(more?.width);
      expect(frame?.height).toBe(more?.height);
      expect(frame?.width).toBe(width === 1280 ? 40 : 32);
      const dot = await button.locator('.bg-accent').boundingBox();
      expect(dot).not.toBeNull();
      const distance = Math.hypot(
        dot!.x + dot!.width / 2 - frame!.x - frame!.width / 2,
        dot!.y + dot!.height / 2 - frame!.y - frame!.height / 2
      );
      expect(Math.abs(distance - frame!.width / 2)).toBeLessThan(1);
      await button.click();
      await expect(
        page.locator('[data-input-id^="thread-reply-input"]')
      ).toBeVisible();
      if (process.env.CALL_REPRO_DIR)
        await page.screenshot({
          path: `${process.env.CALL_REPRO_DIR}/L-81-${width}-${theme}-open-${process.env.CALL_REPRO_PHASE ?? 'after'}.png`,
        });
    });
  }
}

for (const phone of [false, true]) {
  test(`the ${phone ? 'phone' : 'participants-only'} toggle icon retains its size`, async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.CALL_FULL_HOST !== 'true' ||
        (testInfo.project.name === 'phone') !== phone
    );
    await open(page, 'messages', {
      status: { state: 'live' },
      fullOverlay: true,
      chat: phone ? 'on' : 'off',
    });
    const toggle = page.getByRole('button', {
      name: 'Open chat and participants',
    });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    const box = await toggle.locator('svg').first().boundingBox();
    expect(box?.width).toBe(phone ? 24 : 20);
    expect(box?.height).toBe(phone ? 24 : 20);
    if (process.env.CALL_REPRO_DIR)
      await page.screenshot({
        path: `${process.env.CALL_REPRO_DIR}/L-81-${phone ? 'phone' : 'participants'}-after.png`,
      });
  });
}

test('rebuilt call panel keeps a long thread, bottom composer and draft across tabs and reopen', async ({
  page,
}, testInfo) => {
  test.skip(process.env.CALL_FULL_HOST !== 'true');
  if (process.env.CALL_PANEL_WIDTH)
    await page.setViewportSize({
      width: Number(process.env.CALL_PANEL_WIDTH),
      height: 860,
    });
  const { posted } = await open(page, 'panel', {
    status: { state: 'live' },
    fullOverlay: true,
    historyCount: 40,
    replies: Array.from({ length: 60 }, (_, index) =>
      reply(
        `00000000-0000-7000-8000-${(0xb000 + index).toString(16).padStart(12, '0')}`,
        `Call message ${index + 1}`
      )
    ),
  });
  const latest = page.getByText('Call message 60', { exact: true });
  await expect(latest).toBeInViewport({ timeout: 30000 });
  const scroll = page.locator('[data-channel-scroll]');
  const composer = page.locator('[data-input-id^="thread-reply-input"]');
  const editor = composer.locator('[data-markdown-editable]');
  const checkGeometry = async () => {
    const metrics = await scroll.evaluate((el) => ({
      height: el.clientHeight,
      content: el.scrollHeight,
      bottom: el.getBoundingClientRect().bottom,
    }));
    expect(metrics.height).toBeGreaterThan(100);
    expect(metrics.content).toBeGreaterThan(metrics.height);
    await expect
      .poll(async () => {
        const list = await scroll.boundingBox();
        const input = await composer.boundingBox();
        return input!.y - list!.y - list!.height;
      })
      .toBeGreaterThanOrEqual(-1);
  };
  await checkGeometry();
  expect(
    Math.round(
      (await page
        .getByRole(
          testInfo.project.name === 'phone' ? 'dialog' : 'complementary',
          { name: 'Call sidebar' }
        )
        .boundingBox())!.width
    )
  ).toBe(
    testInfo.project.name === 'phone'
      ? page.viewportSize()!.width - 16
      : page.viewportSize()!.width >= 800
        ? 380
        : page.viewportSize()!.width - 24
  );
  await expect(
    page.getByText('Replying in the call thread', { exact: true })
  ).toHaveCount(0);
  if (testInfo.project.name === 'phone') await composer.click();
  await editor.fill('A preserved call draft');
  await scroll.hover();
  await page.mouse.wheel(0, -300);
  await expect(latest).not.toBeInViewport();
  const previous = await scroll.evaluate((el) => el.scrollTop);
  await page.getByText('Participants', { exact: true }).click();
  await page.getByText('Chat', { exact: true }).click();
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeCloseTo(previous, 0);
  await checkGeometry();
  const readingAnchor = await latest.evaluate(
    (el) => el.getBoundingClientRect().top
  );
  if (testInfo.project.name === 'phone') await page.keyboard.press('Escape');
  else
    await page
      .getByRole('complementary', { name: 'Call sidebar' })
      .getByRole('button', { name: 'Close chat and participants' })
      .click();
  await page
    .getByRole('button', { name: 'Open chat and participants' })
    .click();
  await expect(editor).toHaveText('A preserved call draft');
  // Virtualized older rows can change estimates; preserve the actual reading anchor.
  await expect
    .poll(() => latest.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(readingAnchor, 0);
  await checkGeometry();
  if (process.env.CALL_REPRO_DIR)
    await page.screenshot({
      path: `${process.env.CALL_REPRO_DIR}/${process.env.CALL_REPRO_PHASE ?? 'L95'}-${testInfo.project.name}-long-thread.png`,
    });
  await page.getByRole('button', { name: /send/i }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ thread_id: CALL_ID });
});

test('rebuilt call discussion survives the conditional Work tab', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || testInfo.project.name === 'phone'
  );
  await open(page, 'panel', {
    status: { state: 'live' },
    fullOverlay: true,
    work: 'present',
    replies: [
      reply(
        '00000000-0000-7000-8000-000000000b01',
        'Preserved call discussion'
      ),
    ],
  });
  await expect(
    page.getByText('Preserved call discussion', { exact: true })
  ).toBeVisible({ timeout: 30000 });
  const composer = page.locator('[data-input-id^="thread-reply-input"]');
  await composer.locator('[data-markdown-editable]').fill('Draft across Work');
  await page.getByText('Work', { exact: true }).click();
  await expect(
    page.getByText('Review the draft', { exact: true })
  ).toBeVisible();
  if (process.env.CALL_REPRO_DIR)
    await page.screenshot({
      path: `${process.env.CALL_REPRO_DIR}/L95-8-work.png`,
    });
  await page.getByText('Chat', { exact: true }).click();
  await expect(
    page.getByText('Preserved call discussion', { exact: true })
  ).toBeVisible();
  await expect(composer.locator('[data-markdown-editable]')).toHaveText(
    'Draft across Work'
  );
  const bottom = await page
    .locator('[data-channel-scroll]')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect((await composer.boundingBox())!.y).toBeGreaterThanOrEqual(bottom - 1);
  if (process.env.CALL_REPRO_DIR)
    await page.screenshot({
      path: `${process.env.CALL_REPRO_DIR}/L95-8-chat.png`,
    });
});

test('call duration pill follows header width, not viewport width', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || testInfo.project.name === 'phone'
  );
  for (const width of [720, 480]) {
    await open(page, 'messages', {
      status: { state: 'live' },
      fullOverlay: true,
      headerWidth: width,
    });
    await expect(page.getByText('Call channel', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    if (process.env.CALL_REPRO_DIR)
      await page.screenshot({
        path: `${process.env.CALL_REPRO_DIR}/L84-${width}-${process.env.CALL_REPRO_PHASE ?? 'after'}.png`,
      });
    if (width < 560)
      await expect(
        page.getByRole('button', { name: 'Open call', exact: true })
      ).toBeHidden();
    else
      await expect(
        page.getByRole('button', { name: 'Open call', exact: true })
      ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open chat and participants' })
    ).toBeVisible();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('call thread survives crossing the docked width threshold', async ({
  page,
}, info) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || info.project.name !== 'desktop'
  );
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 1280, height: 860 });
    await open(page, 'panel', {
      status: { state: 'live' },
      fullOverlay: true,
      theme,
      historyCount: 40,
      replies: Array.from({ length: 40 }, (_, index) =>
        reply(
          `00000000-0000-7000-8000-${(0xc000 + index).toString(16).padStart(12, '0')}`,
          `Reply ${index + 1}: a deliberately long sentence that wraps at different panel widths and preserves its call-thread owner.`
        )
      ),
    });
    const latest = page.getByText(/^Reply 40:/);
    await expect(latest).toBeInViewport();
    const composer = page.locator('[data-input-id^="thread-reply-input"]');
    const editor = composer.locator('[data-markdown-editable]');
    await editor.click();
    await editor.press('ControlOrMeta+a');
    await editor.press('Backspace');
    await editor.pressSequentially('Preserved across widths');
    await expect(editor).toHaveText('Preserved across widths');
    const original = await composer.elementHandle();
    for (const width of [720, 480, 1280]) {
      await page.setViewportSize({ width, height: 860 });
      await expect(latest).toBeInViewport();
      await expect(editor).toHaveText('Preserved across widths');
      await expect(
        page.getByText('Back to call thread', { exact: true })
      ).toHaveCount(0);
      expect(
        await composer.evaluate((el, previous) => el === previous, original)
      ).toBe(true);
      if (process.env.CALL_REPRO_DIR)
        await page.screenshot({
          path: `${process.env.CALL_REPRO_DIR}/L115-${theme}-${width}.png`,
        });
    }

    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {}))
      )
    );
    const scroll = page.locator('[data-channel-scroll]');
    await scroll.hover();
    await Promise.all([
      scroll.evaluate(
        (el) =>
          new Promise<void>((resolve) =>
            el.addEventListener('scrollend', () => resolve(), { once: true })
          )
      ),
      page.mouse.wheel(0, -350),
    ]);
    await expect(latest).not.toBeInViewport();
    await expect(
      page.getByText('Back to call thread', { exact: true })
    ).toBeVisible();
    const previous = await scroll.evaluate((el) => el.scrollTop);
    await page.setViewportSize({ width: 720, height: 860 });
    await expect(
      page.getByRole('complementary', { name: 'Call sidebar' })
    ).toHaveCSS('width', '696px');
    await page.setViewportSize({ width: 1280, height: 860 });
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollTop))
      .toBeCloseTo(previous, 0);
    await expect(editor).toHaveText('Preserved across widths');
  }
});
