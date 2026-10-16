import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, type WebSocketRoute } from '@playwright/test';
import { buildSchema, graphql } from 'graphql';
import { replyOptions } from '../../src/features/meta-messaging/tests/reply-options';
import type { MessageEvent } from '../../src/lib/service-clients/service-storage/generated/schemas/messageEvent';
import type { MetaConversationView } from '../../src/lib/service-clients/service-storage/generated/schemas/metaConversationView';
import type { MetaSendProgress } from '../../src/lib/service-clients/service-storage/generated/schemas/metaSendProgress';
import type { MetaSendReply } from '../../src/lib/service-clients/service-storage/generated/schemas/metaSendReply';
import type { SoupInput } from '../../src/lib/service-clients/service-storage/graphql/generated/graphql';
import type {
  MessageListItem,
  MessageTimelineEntry,
} from '../../src/lib/service-clients/service-storage/messages';
import { bootstrapResponses } from '../native/fixtures/bootstrap';
import { USER_ID } from '../native/fixtures/mail';

// Real bundled app, routing and query/socket adapters; only remote transport is synthetic.
const origin = process.env.MESSAGING_BROWSER_URL ?? 'http://127.0.0.1:3041';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: 'block',
});
await context.addCookies([{ name: 'login', value: 'true', url: origin }]);
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors: string[] = [];
const unknown = new Set<string>();
page.on('pageerror', (error) => errors.push(error.message));
const gateways = new Set<WebSocketRoute>();
await page.routeWebSocket('**/*', (socket) => {
  if (socket.url().includes('/dss/items/soup/graphql/ws')) {
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { type: string };
      if (frame.type === 'connection_init')
        socket.send(JSON.stringify({ type: 'connection_ack' }));
      if (frame.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
    });
    return;
  }
  if (!socket.url().includes('/connection-gateway')) return socket.close();
  gateways.add(socket);
  socket.onMessage((message) => {
    if (message === 'ping') socket.send('pong');
  });
  socket.onClose(() => gateways.delete(socket));
});
const id = (number: number) =>
  `019a0000-0000-7000-8000-${number.toString().padStart(12, '0')}`;
const channels = [
  { id: id(101), name: 'Native team conversation', provider: null },
  { id: id(102), name: 'WhatsApp customer', provider: 'whatsapp' },
  { id: id(103), name: 'Instagram customer', provider: 'instagram' },
] as const;
let activeUser = USER_ID;
let denied = false;
let bindingError = false;
let holdBinding = false;
let unknownSend = false;
let windowClosed = false;
let failSend = false;
let expireSend = false;
const submissions: MetaSendReply[] = [];
const sends = new Map<string, MetaSendProgress[]>();
const seenNotifications = new Set<string>();
const time = (offset: number) =>
  new Date(Date.now() - 7200000 + offset * 60000).toISOString();
function message(
  channel: string,
  number: number,
  content: string,
  external = false
): MessageListItem {
  const created_at = time(number % 100);
  const sender_id = external ? `external|${id(900)}` : activeUser;
  return {
    id: id(number),
    parent: { type: 'channel', id: channel },
    sender_id,
    imported_author: external ? { name: 'Test Customer' } : null,
    content,
    created_at,
    updated_at: created_at,
    mentions: [],
    reactions: [],
    attachments: [],
    state: {
      root_id: id(number),
      user_id: sender_id,
      created_at,
      updated_at: created_at,
      resolved: false,
    },
    thread: { reply_count: 0, preview: [] },
  };
}
const messages = new Map<string, MessageListItem[]>(
  channels.map((channel, index) => [
    channel.id,
    Array.from({ length: 35 }, (_, number) =>
      message(
        channel.id,
        1000 + index * 100 + number,
        `${channel.name} message ${number + 1}`,
        !!channel.provider
      )
    ),
  ])
);
const unreadReply = message(channels[0].id, 9100, 'Unread thread reply');
unreadReply.thread_id = messages.get(channels[0].id)![3].id;
unreadReply.sender_id = 'macro|teammate@browser.test';
unreadReply.created_at = time(4);
unreadReply.updated_at = unreadReply.created_at;
messages.get(channels[0].id)![3].thread = {
  reply_count: 1,
  preview: [unreadReply],
};
function event(
  value: MessageListItem,
  type: 'posted' | 'edited' | 'message_deleted' = 'posted'
) {
  const change: MessageEvent['change'] =
    type === 'posted'
      ? { type, message: value, mentions: [], notification_policy: 'Silent' }
      : type === 'edited'
        ? {
            type,
            message: value,
            mentions: [],
            notification_policy: 'Default',
            previous_attachments: [],
          }
        : { type, message: value };
  const data: MessageEvent = {
    actor: activeUser,
    parent: value.parent,
    change,
  };
  for (const socket of gateways)
    socket.send(JSON.stringify({ type: 'message_update', data }));
}
function conversation(channelId: string): MetaConversationView | null {
  const channel = channels.find((channel) => channel.id === channelId)!;
  if (!channel.provider) return null;
  const options = replyOptions(channel.provider);
  if (windowClosed)
    options.eligibility.modes[0] = {
      mode: 'free_form',
      allowed: false,
      reason: 'template_required',
    };
  if (denied)
    for (const mode of options.eligibility.modes) {
      mode.allowed = false;
      mode.reason = 'forbidden';
    }
  return {
    ...options,
    provider: channel.provider,
    account_name: 'Test Business',
    status: 'connected',
    can_reply: !denied,
    // Conversation details must not surface developer-only setup.
    developer_account: true,
    human_agent_approved: false,
    text_limit: options.capabilities.text_limit,
    text_limit_in_bytes: options.capabilities.text_limit_in_bytes,
    media: options.capabilities.media,
    sends: sends.get(channelId) ?? [],
    conversation: {
      channel_id: channelId,
      connection_id: id(500),
      customer_id: 'test-customer',
      customer_display_name: 'Test Customer',
      customer_handle:
        channel.provider === 'instagram' ? 'test.customer' : null,
      customer_phone:
        channel.provider === 'whatsapp' ? '+1 202 555 0147' : null,
      last_customer_message_at: time(35),
      standard_window_until: new Date(Date.now() + 3600000).toISOString(),
    },
  };
}
function soupItem(channel: (typeof channels)[number]) {
  const latest = messages.get(channel.id)!.at(-1)!;
  const preview = {
    messageId: latest.id,
    channelId: channel.id,
    threadId: null,
    senderId: latest.sender_id,
    content: latest.content,
    createdAt: latest.created_at,
    updatedAt: latest.updated_at,
    deletedAt: null,
    mentions: [],
  };
  return {
    __typename: 'GraphqlSoupChannel',
    id: channel.id,
    entityType: 'CHANNEL',
    name: channel.name,
    displayName: channel.name,
    channelType: 'private',
    ownerId: activeUser,
    organizationId: null,
    teamId: null,
    createdAt: time(0),
    updatedAt: latest.updated_at,
    viewedAt: null,
    interactedAt: null,
    isParticipant: true,
    participants: [
      {
        channelId: channel.id,
        userId: activeUser,
        role: 'owner',
        joinedAt: time(0),
        leftAt: null,
      },
    ],
    latestMessage: preview,
    latestNonThreadMessage: preview,
    cacheProjection: null,
    isFavorited: false,
    notifications: channel.provider
      ? []
      : [
          {
            id: id(300 + channels.indexOf(channel)),
            entityType: 'CHANNEL',
            entityId: channel.id,
            eventType: 'channel_reply',
            state: seenNotifications.has(id(300 + channels.indexOf(channel)))
              ? 'SEEN'
              : 'UNSEEN',
            sent: true,
            createdAt: messages.get(channel.id)![3].created_at,
            updatedAt: messages.get(channel.id)![3].created_at,
            viewedAt: null,
            senderId: null,
            metadata: {
              __typename: 'GraphqlChannelReplyMetadata',
              messageId: unreadReply.id,
              threadId: messages.get(channel.id)![3].id,
              userId: unreadReply.sender_id,
              threadParentSenderId: activeUser,
              messageContent: 'Unread customer message',
              sender: null,
              senderDisplayName: 'Test Customer',
              channelType: 'PRIVATE',
              channelName: channel.name,
              hasAttachments: false,
              senderProfilePictureUrl: null,
            },
          },
        ],
  };
}
const schema = buildSchema(
  readFileSync(resolve('../../static_assets/schema.graphql'), 'utf8')
);
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const respond = (body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  if (url.origin !== origin) return route.abort();
  if (path.startsWith('/app') || path === '/') return route.continue();
  if (path === '/auth/jwt/refresh') return respond({});
  if (path === '/dss/history') return respond({ data: [] });
  if (path === '/notification/user_notifications')
    return respond({ items: [], next_cursor: null });
  if (path === '/calendar/calendars') return respond({ calendars: [] });
  if (path === '/dss/favorites') return respond({ favorites: [] });
  if (path === '/dss/calendar-events')
    return respond({ items: [], next_cursor: null });
  if (path === '/dss/items/soup/graphql') {
    const body = request.postDataJSON() as {
      query: string;
      variables?: Record<string, unknown>;
      operationName?: string;
    };
    const result = await graphql({
      schema,
      source: body.query,
      variableValues: body.variables,
      operationName: body.operationName,
      rootValue: {
        updateNotifications: ({
          input,
        }: {
          input: { notificationIds: string[] };
        }) => {
          const updated = channels
            .flatMap((channel) => soupItem(channel).notifications)
            .filter((notification) =>
              input.notificationIds.includes(notification.id)
            );
          for (const notification of updated) {
            seenNotifications.add(notification.id);
            notification.state = 'SEEN';
          }
          return updated;
        },
        recordChannelActivity: ({
          input,
        }: {
          input: { channelId: string };
        }) => ({
          id: id(880),
          userId: activeUser,
          channelId: input.channelId,
          createdAt: time(0),
          updatedAt: new Date().toISOString(),
          viewedAt: new Date().toISOString(),
          interactedAt: null,
        }),
        user: {
          id: activeUser,
          emailLinks: [],
          emailLabels: [],
          favorites: [],
          soup: ({ input }: { input: SoupInput }) => {
            const channelId =
              input.initial?.filters?.channelFilter?.literal?.channelId;
            return {
              items:
                body.operationName === 'ChannelListSoup'
                  ? channels.map(soupItem)
                  : channelId
                    ? channels
                        .filter((channel) => channel.id === channelId)
                        .map((channel) => ({
                          ...soupItem(channel),
                          notifications: soupItem(channel).notifications.filter(
                            (notification) => notification.state === 'UNSEEN'
                          ),
                        }))
                    : [],
              nextCursor: null,
            };
          },
        },
      },
    });
    if (result.errors)
      errors.push(...result.errors.map((error) => error.message));
    return respond(result);
  }
  const meta = path.match(
    /^\/dss\/meta\/channels\/([^/]+)(?:\/(replies|delivery|templates))?$/
  );
  if (meta) {
    const channel = meta[1];
    if (!meta[2]) {
      if (holdBinding) return;
      return bindingError
        ? respond({}, 503)
        : respond({ messaging: conversation(channel) });
    }
    if (meta[2] === 'delivery') return respond(sends.get(channel) ?? []);
    if (meta[2] === 'templates')
      return respond([
        {
          id: 'approved-template',
          name: 'order_update',
          language: 'en_US',
          components: [
            { type: 'BODY', text: 'Hello {{1}}, your order is ready.' },
          ],
          parameter_labels: ['body 1'],
        },
      ]);
    const payload = request.postDataJSON() as MetaSendReply;
    if (denied) return respond({}, 403);
    submissions.push(payload);
    const attempt: MetaSendProgress = {
      id: id(5000 + submissions.length),
      channel_id: channel,
      user_id: activeUser,
      created_at: new Date(
        Date.now() - (expireSend ? 600001 : 0)
      ).toISOString(),
      state: unknownSend
        ? 'unknown'
        : failSend || expireSend
          ? 'failed'
          : 'pending',
      error_code: expireSend
        ? 'send_expired'
        : failSend
          ? 'provider_rejected'
          : null,
      payload,
    };
    sends.set(channel, [...(sends.get(channel) ?? []), attempt]);
    if (!unknownSend && !failSend && !expireSend)
      setTimeout(() => {
        const native = message(
          channel,
          6000 + submissions.length,
          payload.message.type === 'text' ? payload.message.text : 'Attachment'
        );
        native.created_at = attempt.created_at;
        native.updated_at = attempt.created_at;
        native.imported_author = { name: 'Test Business' };
        messages.get(channel)!.push(native);
        attempt.state = 'accepted';
        attempt.message_id = native.id;
        event(native);
      }, 1200);
    return respond(attempt);
  }
  const timeline = path.match(/^\/dss\/messages\/channel\/([^/]+)\/timeline$/);
  if (timeline) {
    const entries: MessageTimelineEntry[] = messages
      .get(timeline[1])!
      .map((message) => ({ type: 'message', message }));
    entries.push({
      type: 'activity',
      activity: {
        id: id(700),
        actor_id: activeUser,
        occurred_at: time(33),
        action: 'renamed',
        payload: { to: 'Conversation ready' },
      },
    });
    return respond({
      entries: entries.sort((a, b) =>
        (b.type === 'message'
          ? b.message.created_at
          : b.activity.occurred_at
        ).localeCompare(
          a.type === 'message' ? a.message.created_at : a.activity.occurred_at
        )
      ),
      next_cursor: null,
      previous_cursor: null,
    });
  }
  const item = path.match(
    /^\/dss\/messages\/channel\/([^/]+)\/items\/([^/]+)$/
  );
  if (item) {
    const value = [...messages.get(item[1])!, unreadReply].find(
      (message) => message.id === item[2]
    );
    return value ? respond(value) : respond({}, 404);
  }
  const thread = path.match(
    /^\/dss\/messages\/channel\/([^/]+)\/threads\/([^/]+)$/
  );
  if (thread) {
    const root = messages
      .get(thread[1])!
      .find((message) => message.id === thread[2]);
    return root
      ? respond({ root, state: root.state, replies: root.thread.preview })
      : respond({}, 404);
  }
  if (/^\/dss\/call\/[^/]+\/active$/.test(path)) return respond(null);
  if (path === '/dss/channels/preview') return respond({ previews: [] });
  const parent = path.match(/^\/dss\/messages\/channel\/([^/]+)$/);
  if (parent && request.method() === 'GET') {
    const selection = JSON.parse(url.searchParams.get('selection') ?? '{}') as {
      ids?: string[];
    };
    const items = messages
      .get(parent[1])!
      .filter(
        (message) => !selection.ids || selection.ids.includes(message.id)
      );
    return respond({
      items: [...items].reverse(),
      next_cursor: null,
      previous_cursor: null,
    });
  }
  if (parent && request.method() === 'POST') {
    const input = request.postDataJSON() as {
      content: string;
      id?: string;
      thread_id?: string;
    };
    const value = message(
      parent[1],
      8000 + messages.get(parent[1])!.length,
      input.content
    );
    value.id = input.id ?? value.id;
    value.state.root_id = value.id;
    value.thread_id = input.thread_id ?? null;
    value.created_at = new Date().toISOString();
    value.updated_at = value.created_at;
    if (input.thread_id) {
      const root = messages
        .get(parent[1])!
        .find((message) => message.id === input.thread_id)!;
      root.thread.preview.push(value);
      root.thread.reply_count++;
    } else messages.get(parent[1])!.push(value);
    setTimeout(() => event(value), 100);
    return respond(value);
  }
  if (/^\/dss\/messages\/channel\/[^/]+\/typing$/.test(path))
    return respond({});
  const participants = path.match(/^\/dss\/channels\/([^/]+)\/participants$/);
  if (participants)
    return respond([
      {
        channel_id: participants[1],
        user_id: activeUser,
        role: 'owner',
        joined_at: time(0),
        left_at: null,
      },
    ]);
  if (/^\/dss\/channels\/[^/]+\/bots$/.test(path)) return respond([]);
  if (path === '/auth/user/get_names_with_email')
    return respond({
      names: [{ id: activeUser, first_name: 'Browser', last_name: 'Tester' }],
    });
  const fixture = bootstrapResponses.get(`${request.method()} ${path}`);
  if (fixture)
    return respond(
      JSON.parse(JSON.stringify(fixture.body).replaceAll(USER_ID, activeUser)),
      fixture.status
    );
  unknown.add(`${request.method()} ${path}`);
  return respond({}, 404);
});

async function open(channel: string) {
  await page.goto(`${origin}/app/channel/${channel}`);
  await expect(page.locator('[data-channel-message-list]')).toBeVisible({
    timeout: 30000,
  });
}
async function expectNoCustomerCalls() {
  await expect(
    page.locator(
      '[data-header-action][aria-label="Call"], [data-header-action][aria-label="Join"]'
    )
  ).toHaveCount(0);
  await expect(page.getByText('Calls', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('A call is active in this channel', { exact: true })
  ).toHaveCount(0);
}
try {
  await open(channels[0].id);
  await expect(
    page.locator('[data-header-action][aria-label="Call"]')
  ).toBeVisible();
  await expect(page.getByText('Calls', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Conversation ready', { exact: false })
  ).toBeVisible();
  const nativeInput = page
    .locator(
      `[data-input-id="channel-input-${channels[0].id}"] [contenteditable="true"]`
    )
    .first();
  await expect(nativeInput).toBeVisible();
  await page
    .getByRole('button', { name: /unread notification.*above/ })
    .click();
  await expect(
    page.locator(`[data-message-id="${unreadReply.id}"]`)
  ).toBeInViewport();
  await nativeInput.fill('Native browser reply');
  await page
    .locator(
      `[data-input-id="channel-input-${channels[0].id}"] [data-input-action="send"]`
    )
    .click();
  await page
    .locator('[data-channel-scroll]')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(
    page
      .locator('[data-channel-message-list]')
      .getByText('Native browser reply', { exact: true })
  ).toHaveCount(1);

  await open(`${channels[1].id}?join_call=true&open_call_tab=true`);
  await expectNoCustomerCalls();
  const input = page.getByRole('textbox', { name: 'External customer reply' });
  await expect(
    page.locator('[data-input-id^="channel-input-"] [contenteditable="true"]')
  ).toHaveCount(0);
  await input.fill('External browser reply');
  await page.getByRole('button', { name: 'Send reply via WhatsApp' }).click();
  await expect(
    page
      .locator('[data-channel-message-list]')
      .getByText('External browser reply', { exact: true })
  ).toHaveCount(1);
  await expect
    .poll(() => sends.get(channels[1].id)?.[0]?.state)
    .toBe('accepted');
  await expect(
    page.locator(
      `[data-message-id="${sends.get(channels[1].id)![0].message_id}"]`
    )
  ).toBeVisible();
  await expect(
    page
      .locator('[data-channel-message-list]')
      .getByText('External browser reply', { exact: true })
  ).toHaveCount(1);
  await input.fill('Saved WhatsApp draft');
  await open(channels[2].id);
  await expect(input).toHaveValue('');
  await page
    .getByRole('button', { name: 'Instagram conversation details' })
    .click();
  await expect(page.getByText('@test.customer', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Test Customer', { exact: true }).last()
  ).toBeVisible();
  await page.keyboard.press('Escape');
  const revised = messages.get(channels[2].id)!.at(-1)!;
  revised.content = 'Edited customer message';
  revised.edited_at = new Date().toISOString();
  event(revised, 'edited');
  await expect(page.locator(`[data-message-id="${revised.id}"]`)).toContainText(
    'Edited customer message'
  );
  revised.content = '';
  revised.deleted_at = new Date().toISOString();
  event(revised, 'message_deleted');
  messages.set(
    channels[2].id,
    messages.get(channels[2].id)!.filter((message) => message.id !== revised.id)
  );
  await expect(page.locator(`[data-message-id="${revised.id}"]`)).toHaveCount(
    0
  );
  await input.fill('Saved Instagram draft');
  await open(channels[1].id);
  await expect(input).toHaveValue('Saved WhatsApp draft');
  await page.reload();
  await expect(input).toHaveValue('Saved WhatsApp draft');
  activeUser = 'macro|second-browser-user@example.com';
  await page.reload();
  await expect(input).toHaveValue('');
  await input.fill('Second user draft');
  activeUser = USER_ID;
  await page.reload();
  await expect(input).toHaveValue('Saved WhatsApp draft');
  holdBinding = true;
  await page.reload();
  await expect(
    page.getByLabel('Loading conversation', { exact: true })
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  await expectNoCustomerCalls();
  holdBinding = false;
  bindingError = true;
  await page.reload();
  await expect(
    page.getByText('Conversation unavailable.', { exact: false })
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  await expectNoCustomerCalls();
  bindingError = false;
  denied = true;
  await page.reload();
  await expect(input).toHaveValue('Saved WhatsApp draft');
  await expect(
    page.getByRole('button', { name: 'Send reply via WhatsApp' })
  ).toBeDisabled();
  denied = false;
  await page.reload();
  await input.fill('Uncertain browser reply');
  unknownSend = true;
  await page.getByRole('button', { name: 'Send reply via WhatsApp' }).click();
  await page.getByRole('button', { name: 'Review reply', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Send reply via WhatsApp' })
  ).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(
    page.getByRole('button', { name: 'Send reply via WhatsApp' })
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  unknownSend = false;

  // Templates stay out of normal replies and appear only when required.
  activeUser = 'macro|template-browser-user@example.com';
  await page.reload();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /template/i })).toHaveCount(0);
  await expect(page.getByText(/template/i)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'WhatsApp conversation details' })
    .click();
  await expect(page.getByText('WhatsApp messages sent from')).toBeVisible();
  await expect(
    page.getByText('+1 202 555 0147', { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/test account/i)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '/tmp/macro-messaging-browser-normal.png' });

  windowClosed = true;
  await page.reload();
  await input.fill('Typed before the window closed');
  const sendButton = page.getByRole('button', {
    name: 'Send reply via WhatsApp',
  });
  await expect(sendButton).toBeDisabled();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByText('The reply window is closed.')).toBeVisible();
  await page.screenshot({ path: '/tmp/macro-messaging-browser-closed.png' });
  await page.getByRole('button', { name: 'Choose template' }).click();
  const picker = page.getByRole('combobox', {
    name: 'Approved WhatsApp template',
  });
  await picker.selectOption('approved-template');
  await page.getByLabel('body 1').fill('Avery');
  await page.reload();
  await expect(picker).toHaveValue('approved-template');
  await expect(page.getByLabel('body 1')).toHaveValue('Avery');
  await page.screenshot({ path: '/tmp/macro-messaging-browser-template.png' });
  await page.getByRole('button', { name: 'Back to text reply' }).click();
  await expect(input).toHaveValue('Typed before the window closed');
  await page.getByRole('button', { name: 'Choose template' }).click();
  await expect(picker).toHaveValue('approved-template');
  failSend = true;
  await sendButton.click();
  await expect(input).toHaveValue('Typed before the window closed');
  assert.deepEqual(submissions.at(-1)?.message, {
    type: 'template',
    template_id: 'approved-template',
    language: 'en_US',
    parameters: ['Avery'],
  });
  failSend = false;
  await input.fill('');
  await page.getByRole('button', { name: 'Edit and retry' }).last().click();
  await expect(picker).toHaveValue('approved-template');
  await expect(page.getByLabel('body 1')).toHaveValue('Avery');
  await expect(sendButton).toBeEnabled();
  windowClosed = false;
  await page.reload();
  await expect(picker).toHaveValue('approved-template');
  await page.getByRole('button', { name: 'Back to text reply' }).click();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /template/i })).toHaveCount(0);
  activeUser = 'macro|expiry-browser-user@example.com';
  await page.reload();
  await expect(input).toHaveValue('');
  await input.fill('Expired reply kept for editing');
  expireSend = true;
  await sendButton.click();
  const expiredIntent = submissions.at(-1)!;
  const expiredId = sends.get(channels[1].id)!.at(-1)!.id;
  const expiredRow = page.locator(`[data-external-send-id="${expiredId}"]`);
  await expect(
    expiredRow.getByRole('status', { name: 'Not sent', exact: true })
  ).toBeVisible();
  await expiredRow.getByRole('button', { name: 'Edit and retry' }).click();
  await expect(input).toHaveValue('Expired reply kept for editing');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expireSend = false;
  await sendButton.click();
  assert.notEqual(
    submissions.at(-1)!.idempotency_key,
    expiredIntent.idempotency_key
  );
  await expectNoCustomerCalls();
  activeUser = USER_ID;
  await page.screenshot({
    path: '/tmp/macro-messaging-browser.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual([...unknown], []);
  console.log(
    JSON.stringify({
      passed: [
        'ordinary channel send/activity and preserved Call controls',
        'hidden customer Call surfaces during loading/error and join-call deep links',
        'Not sent expiry and recovered draft with a new intent key',
        'external send/native replacement',
        'cross-channel, reload and user-switch drafts',
        'loading/error binding',
        'unread navigation',
        'server denial',
        'unknown acknowledgement reset',
        'source edit/unsend display',
        'no template controls or developer label in normal replies',
        'explicit template only when the window is closed',
        'template draft persistence and failed-template recovery',
      ],
      submissions: submissions.length,
    })
  );
} catch (error) {
  await page.screenshot({
    path: '/tmp/macro-messaging-browser-failure.png',
    fullPage: true,
  });
  console.log((await page.locator('body').innerText()).slice(0, 5000));

  throw error;
} finally {
  console.log(JSON.stringify({ errors, unknown: [...unknown] }));
  await context.close();
  await browser.close();
}
