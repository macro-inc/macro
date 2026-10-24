import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const USER_ID = 'macro|wa-tester@example.test';

/** One row of the account's WhatsApp chat list. */
type Chat = {
  jid: string;
  kind: 'group' | 'direct';
  name: string;
  last_activity_at: string | null;
  group: { id: string; name: string } | null;
  shared?: { id: string; name: string; owner_id: string };
};

/** Server state the mocked DSS `/meta/linked` routes answer from. */
type LinkedServer = {
  account: null | {
    id: string;
    user_id: string;
    authorization_generation: number;
    identity_jid: string | null;
    state: string;
  };
  pairingState: string;
  chats: Chat[];
  /** The added group's history import, as `GET /whatsapp-groups/{id}` reports it. */
  backfill: { state: string; imported: number } | null;
  /** History the owner's phone sent so far, older than everything shown. */
  imported: unknown[];
  requests: string[];
  adoptions: unknown[];
  passkeyAnswers: unknown[];
  canSend: boolean;
  sharedViewer: boolean;
  outgoing: unknown[];
  grants: { userId: string; accessLevel: string }[];
  permissionUpdates: unknown[];
  readMessages: string[];
  /** Responses for the next sends, in order; afterwards a send is recorded. */
  sendReplies: { status: number; json: unknown }[];
  /** Progress `POST /delivery` reports, by send id. */
  delivery: Record<string, { state: string; message_id: string | null }>;
};

function server(): LinkedServer {
  return {
    account: null,
    pairingState: 'qr',
    backfill: null,
    imported: [],
    chats: [
      {
        jid: '14155550199@s.whatsapp.net',
        kind: 'direct',
        name: 'Ana Ruiz',
        last_activity_at: '2026-10-21T10:00:00Z',
        group: null,
      },
      {
        jid: '120363001@g.us',
        kind: 'group',
        name: 'Design Crit',
        last_activity_at: '2026-10-21T09:00:00Z',
        group: { id: GROUP_ID, name: 'design-crit' },
      },
      {
        jid: '120363003@g.us',
        kind: 'group',
        name: 'Launch War Room',
        last_activity_at: '2026-10-20T09:00:00Z',
        group: null,
      },
      {
        jid: '120363004@g.us',
        kind: 'group',
        name: 'Ana, Ben, +2',
        last_activity_at: null,
        group: null,
        shared: {
          id: 'group-shared-family',
          name: 'Ana, Ben, +2',
          owner_id: 'macro|owner@example.test',
        },
      },
    ],
    requests: [],
    adoptions: [],
    passkeyAnswers: [],
    canSend: true,
    sharedViewer: false,
    outgoing: [],
    grants: [],
    permissionUpdates: [],
    readMessages: [],
    sendReplies: [],
    delivery: {},
  };
}

const GROUP_ID = '019a061e-0000-7000-8000-000000000001';
const incomingMessage = {
  id: 'message-1',
  kind: 'message',
  mentions: [],
  forwarded: false,
  rich: null,
  sender: { name: 'Ana Ruiz', user_id: null },
  body: 'The updated designs are ready for review.',
  sent_at: '2026-10-21T10:00:00Z',
  edited_at: null,
  deleted: false,
  reply_to: null,
  reactions: [{ emoji: '👍', count: 2, mine: false }],
  attachments: [
    {
      ordinal: 0,
      state: 'loading',
      file_name: 'design.pdf',
      document_id: null,
    },
  ],
  delivery_state: null,
};

/** Real client, queries and production adapter; the network is mocked here. */
async function mount(page: Page, state: LinkedServer, query = '') {
  const origin = test.info().project.use.baseURL;
  const unexpected: string[] = [];
  page.on('pageerror', (error) => unexpected.push(error.message));
  await page.addInitScript(() => localStorage.setItem('macro:login', 'true'));
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/auth/user/legacy_user_permissions')
      return route.fulfill({
        json: {
          userId: USER_ID,
          email: 'wa-tester@example.test',
          permissions: [],
          tutorialComplete: true,
        },
      });
    if (url.pathname.startsWith('/auth/user/get_names'))
      return route.fulfill({
        json: {
          names: [
            {
              id: 'macro|owner@example.test',
              first_name: 'Group',
              last_name: 'Owner',
            },
            { id: USER_ID, first_name: 'Me' },
          ],
        },
      });
    if (url.pathname === '/auth/user/profile_pictures')
      return route.fulfill({ json: { pictures: [] } });
    if (url.pathname === '/auth/team/user')
      return route.fulfill({
        json: [
          {
            id: 'team-acme',
            name: 'Acme Inc',
            slug: 'acme',
            owner_id: USER_ID,
            allow_non_admin_invites: true,
            crm_enabled: false,
            enterprise: false,
          },
        ],
      });
    if (url.pathname.endsWith('/email/links'))
      return route.fulfill({ json: { links: [] } });
    if (url.pathname === '/auth/team')
      return route.fulfill({
        json: {
          team: { id: 'team-acme', name: 'Acme Inc', owner_id: USER_ID },
          members: [],
        },
      });
    if (url.pathname.startsWith(`/dss/entities/whatsapp_group/${GROUP_ID}`)) {
      if (url.pathname.includes('/direct-access/')) {
        state.grants.push({
          userId: decodeURIComponent(url.pathname.split('/').at(-1) ?? ''),
          accessLevel: route.request().postDataJSON().accessLevel,
        });
        return route.fulfill({ status: 204 });
      }
      if (url.pathname.endsWith('/direct-access'))
        return route.fulfill({ json: state.grants });
      return route.fulfill({
        json: {
          owner: state.sharedViewer ? 'macro|owner@example.test' : USER_ID,
          canReview: !state.sharedViewer,
          accessLevel: state.sharedViewer ? 'view' : 'owner',
          supportedLevels: ['view'],
          requests: [],
          pendingCount: 0,
          mine: null,
          nextOffset: null,
        },
      });
    }
    if (url.pathname.startsWith('/dss/meta/linked/')) {
      const path = url.pathname.slice('/dss/meta/linked/'.length);
      const method = route.request().method();
      state.requests.push(`${method} ${path}`);
      if (path.startsWith(`whatsapp-groups/${GROUP_ID}`)) {
        const suffix = path.slice(`whatsapp-groups/${GROUP_ID}`.length);
        if (!suffix)
          return route.fulfill({
            json: {
              id: GROUP_ID,
              name: 'Design Crit',
              user_id: state.sharedViewer
                ? 'macro|owner@example.test'
                : USER_ID,
              access_level: state.sharedViewer ? 'view' : 'owner',
              can_send: state.canSend,
              send_reason: state.canSend ? null : 'no_account',
              sending_identity: state.canSend
                ? '14155550142@s.whatsapp.net'
                : null,
              unread_count: 1,
              backfill: state.backfill,
              roster: {
                participants: [
                  {
                    jid: '14155550199@s.whatsapp.net',
                    displayName: 'Ana Ruiz',
                    admin: true,
                  },
                ],
              },
              limits: {
                text_limit_bytes: 65536,
                attachment_limit_bytes: 33554432,
                mutation_window_seconds: 900,
                max_attachments: 1,
                mutations: ['reaction', 'edit', 'delete'],
                attachment_types: ['image/png', 'application/pdf', 'audio/ogg'],
              },
            },
          });
        if (suffix === '/messages')
          return route.fulfill({
            json: {
              next_cursor: url.searchParams.has('before')
                ? null
                : 'older-cursor',
              messages: url.searchParams.has('before')
                ? [
                    {
                      ...incomingMessage,
                      id: 'message-0',
                      body: 'Previous day discussion',
                      sent_at: '2026-10-20T10:00:00Z',
                      attachments: [],
                    },
                  ]
                : [
                    ...state.imported,
                    incomingMessage,
                    {
                      ...incomingMessage,
                      id: 'message-2',
                      body: 'Looking now. Thanks, Ana!',
                      sender: { name: 'Me', user_id: USER_ID },
                      sent_at: new Date().toISOString(),
                      reply_to: 'message-1',
                      reactions: [],
                      attachments: [],
                      delivery_state: 'delivered',
                    },
                  ],
            },
          });
        if (suffix === '/sends' && method === 'POST') {
          const body = route.request().postDataJSON();
          state.outgoing.push(body);
          const reply = state.sendReplies.shift();
          if (reply)
            return route.fulfill({ status: reply.status, json: reply.json });
          const id = `send-${body.idempotency_key}`;
          state.delivery[id] ??= { state: 'pending', message_id: null };
          return route.fulfill({
            json: {
              id,
              group_id: GROUP_ID,
              user_id: USER_ID,
              created_at: new Date().toISOString(),
              payload: body,
              ...state.delivery[id],
            },
          });
        }
        if (suffix === '/delivery')
          return route.fulfill({
            json: (route.request().postDataJSON() as string[])
              .filter((id) => state.delivery[id])
              .map((id) => ({
                id,
                group_id: GROUP_ID,
                user_id: USER_ID,
                created_at: new Date().toISOString(),
                payload: {},
                ...state.delivery[id],
              })),
          });
        if (suffix === '/read') {
          state.readMessages.push(route.request().postDataJSON().message_id);
          return route.fulfill({ json: {} });
        }
        if (suffix === '/attachments')
          return route.fulfill({
            json: {
              upload_id: 'upload-1',
              filename: 'design.pdf',
              kind: 'document',
            },
          });
        if (suffix === '/permissions' && method === 'PATCH') {
          state.permissionUpdates.push(route.request().postDataJSON());
          return route.fulfill({ status: 204 });
        }
        if (suffix === '/permissions')
          return route.fulfill({
            json: {
              id: 'permissions-1',
              channelSharePermissions: [],
              linkShare: null,
              linkShareAccessLevel: null,
              teamShareAccessLevel: null,
            },
          });
      }
      if (url.pathname.startsWith(`/dss/entities/whatsapp_group/${GROUP_ID}`))
        return route.fulfill({ json: {} });
      if (path === 'configuration')
        return route.fulfill({
          json: { pairing: true, adoption: true, sending: true },
        });
      if (path === 'whatsapp-groups')
        return route.fulfill({
          json: state.chats
            .filter((item) => item.group)
            .map((item) => ({
              id: item.group?.id,
              name: item.group?.name,
              user_id: USER_ID,
              unread_count: item.group?.id === GROUP_ID ? 2 : 0,
              can_send: item.group?.id === GROUP_ID,
              send_reason: item.group?.id === GROUP_ID ? null : 'not_observing',
            })),
        });
      if (path === 'account')
        return route.fulfill({ json: { account: state.account } });
      if (path === 'connect')
        return route.fulfill({
          json: {
            id: 'pairing-1',
            account_id: 'account-1',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            state: 'waiting',
          },
        });
      if (path === 'pairing/pairing-1' && method === 'DELETE')
        return route.fulfill({ status: 204 });
      if (path === 'pairing/pairing-1/passkey') {
        state.passkeyAnswers.push(route.request().postDataJSON());
        return route.fulfill({ status: 204 });
      }
      if (path === 'pairing/pairing-1') {
        if (state.pairingState === 'success')
          state.account = {
            id: 'account-1',
            user_id: USER_ID,
            authorization_generation: 4,
            identity_jid: '14155550142:3@s.whatsapp.net',
            state: 'connected',
          };
        return route.fulfill({
          headers: { 'Cache-Control': 'no-store' },
          json: {
            state: state.pairingState,
            qr: state.pairingState === 'qr' ? '2@ref,noise,identity,adv' : null,
            challenge:
              state.pairingState === 'passkey'
                ? { challenge: 'Y2hhbGxlbmdl', rpId: 'whatsapp.com' }
                : null,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        });
      }
      if (path === 'chats' && method === 'GET')
        return route.fulfill({
          json: {
            chats: state.chats.map((chat) => ({
              ...chat,
              archived: false,
              pinned: false,
              shared: chat.group ? null : (chat.shared ?? null),
              can_add: chat.kind === 'group' && !chat.group && !chat.shared,
              cannot_add_reason:
                chat.kind === 'direct'
                  ? "direct chats can't be added to Macro yet"
                  : null,
            })),
          },
        });
      if (path === 'groups/adopt' && method === 'POST') {
        const body = route.request().postDataJSON() as { group_jid: string };
        state.adoptions.push(body);
        const group = state.chats.find(({ jid }) => jid === body.group_jid);
        if (group) group.group = { id: 'group-new', name: group.name };
        return route.fulfill({
          json: {
            id: 'binding-1',
            group_id: 'group-new',
            group_jid: body.group_jid,
            team_id: 'team-acme',
            user_id: USER_ID,
            adopted_at: '2026-10-20T12:00:00Z',
            ownership_state: 'active',
            state: 'active',
          },
        });
      }
      if (path === 'disconnect') {
        state.account = null;
        return route.fulfill({ json: { remote_unlink_requested: true } });
      }
      return route.fulfill({ status: 404, json: {} });
    }
    // Chat's channel list feeds the composer's `@` menu; this account has none.
    if (url.pathname === '/dss/channels/activity')
      return route.fulfill({ json: [] });
    if (url.pathname === '/dss/comms/channels')
      return route.fulfill({ json: { items: [], next_cursor: null } });
    if (/^\/(auth|dss|notification|connection-gateway)\//.test(url.pathname))
      return route.fulfill({ json: {} });
    return route.fulfill({ response: await route.fetch() });
  });
  await page.goto(
    `${origin}/tests/functional/whatsapp-linked/index.html${query}`
  );
  return unexpected;
}

test('links WhatsApp by QR, then adds a shareable WhatsApp group', async ({
  page,
}) => {
  const state = server();
  const unexpected = await mount(page, state);

  await expect(page.getByText(/unofficial WhatsApp client/)).toBeVisible();
  await page.getByRole('button', { name: 'Connect' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveClass(/ph-no-capture/);
  await expect(
    dialog.getByRole('img', {
      name: 'Scan this code with WhatsApp on your phone',
    })
  ).toBeVisible();
  await expect(dialog.getByText(/Expires in \d:\d\d/)).toBeVisible();

  state.pairingState = 'success';
  await expect(page.getByText('+14155550142')).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(state.requests).not.toContain('DELETE pairing/pairing-1');

  const groups = page.getByRole('list', { name: 'Groups to add to Macro' });
  await expect(groups.getByText('Launch War Room')).toBeVisible();
  await expect(groups.getByText('Design Crit')).toHaveCount(0);
  // Direct chats are listed by recent activity but can't be added yet.
  await page.getByRole('button', { name: /Can't be added \(1\)/ }).click();
  const direct = page
    .getByRole('list', { name: "Can't be added" })
    .getByRole('listitem')
    .filter({ hasText: 'Ana Ruiz' });
  await expect(direct.getByText("Can't add direct chats yet")).toBeVisible();
  await expect(direct.getByRole('button')).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Search WhatsApp chats' });
  await search.fill('design');
  await expect(
    page
      .getByRole('list', { name: 'WhatsApp chats in Macro' })
      .getByText('Design Crit')
  ).toBeVisible();
  await search.fill('launch');
  await expect(groups.getByRole('listitem')).toHaveCount(1);
  await search.fill('');
  await expect(groups.getByRole('listitem')).toHaveCount(2);
  await groups
    .getByRole('button', { name: /shared with you by Group Owner/i })
    .click();
  expect(await page.evaluate(() => window.openedGroups)).toEqual([
    'group-shared-family',
  ]);

  await groups.getByRole('button', { name: 'Add to Macro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(groups.getByText('Launch War Room')).toHaveCount(0);
  expect(state.adoptions).toEqual([{ group_jid: '120363003@g.us' }]);
  expect(unexpected).toEqual([]);
});

test('a refused add says why, on that group', async ({ page }) => {
  const state = server();
  state.account = {
    id: 'account-1',
    user_id: USER_ID,
    authorization_generation: 4,
    identity_jid: '14155550142:3@s.whatsapp.net',
    state: 'connected',
  };
  const unexpected = await mount(page, state);
  // Registered last, so it answers before the catch-all mock.
  await page.route('**/dss/meta/linked/groups/adopt', (route) =>
    route.fulfill({
      status: 409,
      json: {
        code: 'disconnected',
        message: 'connect your WhatsApp account first',
      },
    })
  );
  const row = page
    .getByRole('list', { name: 'Groups to add to Macro' })
    .getByRole('listitem')
    .filter({ hasText: 'Launch War Room' });
  await row.getByRole('button', { name: 'Add to Macro' }).click();
  await expect(row.getByRole('alert')).toHaveText(
    'Your WhatsApp is disconnected. Reconnect it, then add the group.'
  );
  expect(unexpected).toEqual([]);
});

test('External lists groups in Macro with unread counts and read-only tags', async ({
  page,
}) => {
  const state = server();
  state.chats[2].group = { id: 'group-shared', name: 'Launch War Room' };
  const unexpected = await mount(page, state, '?view=in-macro');
  const nav = page.getByRole('navigation', {
    name: 'WhatsApp groups in Macro',
  });
  const design = nav.getByRole('button', { name: /design-crit/ });
  await expect(design.getByLabel('2 unread messages')).toBeVisible();
  await expect(
    nav.getByRole('button', { name: /Launch War Room/ }).getByText('Read-only')
  ).toBeVisible();
  await design.click();
  expect(await page.evaluate(() => window.openedGroups)).toEqual([GROUP_ID]);
  expect(unexpected).toEqual([]);
});

test('cancelling a pairing tells the server and keeps the account unlinked', async ({
  page,
}) => {
  const state = server();
  await mount(page, state);

  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('img', { name: /Scan this code/ })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(() => state.requests).toContain('DELETE pairing/pairing-1');
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
});

test('an expired pairing offers a new code', async ({ page }) => {
  const state = server();
  state.pairingState = 'expired';
  await mount(page, state);

  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByText('This code expired before it was scanned.')
  ).toBeVisible();
  state.pairingState = 'qr';
  await page.getByRole('button', { name: 'Show a new code' }).click();
  await expect(page.getByRole('img', { name: /Scan this code/ })).toBeVisible();
  expect(
    state.requests.filter((request) => request === 'POST connect')
  ).toHaveLength(2);
});

test('a browser hands WhatsApp’s passkey step to Macro desktop by pairing id', async ({
  page,
}) => {
  const state = server();
  state.pairingState = 'passkey';
  await mount(page, state);

  await page.getByRole('button', { name: 'Connect' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Confirm on your desktop')).toBeVisible();
  await expect(
    dialog.getByRole('link', { name: 'Continue in Macro desktop' })
  ).toHaveAttribute('href', 'macro:///external?whatsappPairing=pairing-1');
  expect(state.passkeyAnswers).toEqual([]);
});

test('Macro desktop shows its authenticator’s QR while the phone confirms', async ({
  page,
}) => {
  const state = server();
  state.pairingState = 'passkey';
  await mount(page, state, '?passkey=native');

  await page.getByRole('button', { name: 'Connect' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm with passkey' }).click();
  await expect(
    dialog.getByRole('img', {
      name: "Scan this code with your phone's camera to confirm",
    })
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Waiting for your phone…' })
  ).toBeDisabled();
});

/** The shared channel composer; Lexical takes typed text. */
async function typeInComposer(page: Page, text: string) {
  const editor = page.locator(
    '[data-input-editor-shell] [contenteditable="true"]'
  );
  await editor.click();
  await page.keyboard.type(text);
}

test('an independent group reads, replies, reacts and pages through channel rows', async ({
  page,
}) => {
  const state = server();
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  await expect(
    page.getByRole('heading', { name: 'Design Crit' })
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Message Design Crit as +14155550142' })
  ).toBeVisible();
  await expect(page.getByText('Loading design.pdf…')).toBeVisible();
  await expect(page.getByText(/may already have arrived/)).toHaveCount(0);
  await expect.poll(() => state.readMessages).toContain('message-2');
  expect(state.outgoing).toEqual([]);
  await page.locator('[data-message-id="message-1"]').hover();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByText('Replying to Ana Ruiz')).toBeVisible();
  await typeInComposer(page, 'Thanks from my own WhatsApp');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => state.outgoing.length).toBe(1);
  expect(state.outgoing[0]).toMatchObject({
    message: { type: 'text', text: 'Thanks from my own WhatsApp' },
    reply_to: 'message-1',
  });
  // Shown at once, before WhatsApp accepts it.
  await expect(
    page.getByText('Thanks from my own WhatsApp', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Replying to Ana Ruiz')).toHaveCount(0);
  await page.locator('[data-message-reaction-chip][data-emoji="👍"]').click();
  await expect.poll(() => state.outgoing.length).toBe(2);
  expect(state.outgoing[1]).toMatchObject({
    message: {
      type: 'mutation',
      operation: 'reaction',
      message_id: 'message-1',
      text: '👍',
    },
  });
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.getByText('Previous day discussion')).toBeVisible();
  expect(state.requests.some((request) => request.includes('channels/'))).toBe(
    false
  );
  expect(unexpected).toEqual([]);
});

/** One of each WhatsApp message type Macro shows, oldest first. */
function everyMessageType() {
  const at = (minute: number) =>
    `2026-10-21T09:${String(minute).padStart(2, '0')}:00Z`;
  const base = {
    ...incomingMessage,
    body: '',
    reactions: [],
    attachments: [],
  };
  const file = (id: string, mime: string, extra: Record<string, unknown>) => ({
    ordinal: 0,
    state: 'ready',
    file_name: id,
    mime,
    size: 1024,
    document_id: `document-${id}`,
    width: null,
    height: null,
    duration_seconds: null,
    presentation: null,
    ...extra,
  });
  return [
    {
      ...base,
      id: 'type-system',
      kind: 'system',
      sent_at: at(1),
      rich: {
        type: 'system',
        action: 'participants_added',
        actor: { name: 'Ana Ruiz', user_id: null },
        participants: [{ name: '+1 555 0100', user_id: null }],
        value: null,
        call: null,
      },
    },
    {
      ...base,
      id: 'type-mention',
      sent_at: at(2),
      forwarded: true,
      body: 'Ping @15550001111 about https://example.com',
      mentions: [{ token: '15550001111', name: 'Ben Ode', user_id: null }],
    },
    {
      ...base,
      id: 'type-poll',
      sent_at: at(3),
      rich: {
        type: 'poll',
        question: 'Lunch?',
        options: [
          { name: 'Tacos', votes: 2, mine: true, voters: [] },
          { name: 'Pho', votes: 0, mine: false, voters: [] },
        ],
        selectable_count: 1,
        voters: 2,
      },
    },
    {
      ...base,
      id: 'type-location',
      sent_at: at(4),
      rich: {
        type: 'location',
        latitude: 40.7128,
        longitude: -74.006,
        name: 'City Hall',
        address: null,
        url: null,
        live: false,
        comment: null,
      },
    },
    {
      ...base,
      id: 'type-contacts',
      sent_at: at(5),
      rich: {
        type: 'contacts',
        contacts: [{ name: 'Dee Vee', phones: ['+1 555 0200'] }],
      },
    },
    {
      ...base,
      id: 'type-event',
      sent_at: at(6),
      rich: {
        type: 'event',
        name: 'Launch party',
        description: null,
        start_at: '2026-10-24T22:00:00Z',
        end_at: null,
        location: 'Rooftop',
        join_link: null,
        canceled: false,
      },
    },
    {
      ...base,
      id: 'type-sticker',
      sent_at: at(7),
      attachments: [
        file('sticker.webp', 'image/webp', {
          presentation: 'sticker',
          width: 512,
          height: 512,
        }),
      ],
    },
    {
      ...base,
      id: 'type-gif',
      sent_at: at(8),
      attachments: [
        file('gif.mp4', 'video/mp4', {
          presentation: 'gif',
          width: 320,
          height: 240,
        }),
      ],
    },
    {
      ...base,
      id: 'type-voice',
      sent_at: at(9),
      attachments: [
        file('voice.ogg', 'audio/ogg', {
          presentation: 'voice_note',
          duration_seconds: 42,
        }),
      ],
    },
    {
      ...base,
      id: 'type-photo',
      sent_at: at(10),
      attachments: [
        file('photo.jpg', 'image/jpeg', { width: 800, height: 400 }),
      ],
    },
    {
      ...base,
      id: 'type-call',
      kind: 'system',
      sent_at: at(11),
      rich: {
        type: 'system',
        action: 'call',
        actor: null,
        participants: [],
        value: null,
        call: { video: true, outcome: 'missed', duration_seconds: null },
      },
    },
    {
      ...base,
      id: 'type-view-once',
      sent_at: at(12),
      body: 'View-once message — open it on your phone',
    },
  ];
}

test('every WhatsApp message type renders with Chat parts and small cards', async ({
  page,
}) => {
  const state = server();
  state.imported = everyMessageType();
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  const timeline = page.getByRole('log', { name: 'WhatsApp messages' });
  await expect(
    timeline.locator('[data-system-activity="type-system"]')
  ).toContainText('Ana Ruiz added +1 555 0100');
  await expect(
    timeline.locator('[data-system-activity="type-call"]')
  ).toContainText('Missed group video call');
  // System lines are rows of their own, never messages with actions.
  await expect(timeline.locator('[data-message-id="type-system"]')).toHaveCount(
    0
  );
  const mention = timeline.locator('[data-message-id="type-mention"]');
  await expect(mention.getByText('Forwarded')).toBeVisible();
  await expect(mention.getByText('@Ben Ode')).toBeVisible();
  await expect(mention.getByText('@15550001111')).toHaveCount(0);
  await expect(
    mention.getByRole('link', { name: 'https://example.com' })
  ).toHaveAttribute('href', 'https://example.com');
  const poll = timeline.locator('[data-whatsapp-card="poll"]');
  await expect(poll).toContainText('Lunch?');
  await expect(poll).toContainText('2 votes from 2 people');
  await expect(poll.getByRole('button')).toHaveCount(0);
  await expect(
    timeline.getByRole('link', { name: 'Open in Maps' })
  ).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=40.7128%2C-74.006'
  );
  await expect(
    timeline.locator('[data-whatsapp-card="contacts"]')
  ).toContainText('Dee Vee');
  await expect(timeline.locator('[data-whatsapp-card="event"]')).toContainText(
    'Launch party'
  );
  await expect(timeline.getByText('Voice note · 0:42')).toBeVisible();
  // Media reserves its declared shape while it loads.
  const reserved = await timeline
    .locator('[role="status"][aria-label^="Loading "]')
    .evaluateAll((boxes) =>
      boxes.map((box) => [
        box.getAttribute('aria-label'),
        Math.round(box.getBoundingClientRect().width),
        Math.round(box.getBoundingClientRect().height),
      ])
    );
  expect(reserved).toEqual(
    expect.arrayContaining([
      ['Loading sticker.webp', 144, 144],
      ['Loading gif.mp4', 320, 240],
      ['Loading photo.jpg', 400, 200],
    ])
  );
  await expect(
    timeline.getByText('View-once message — open it on your phone')
  ).toBeVisible();
  // The newest row is in view: the timeline opened at the bottom.
  await expect(
    timeline.locator('[data-message-id="message-2"]')
  ).toBeInViewport();
  expect(unexpected).toEqual([]);
});

test('the composer mentions group participants as WhatsApp mentions', async ({
  page,
}) => {
  const state = server();
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  await typeInComposer(page, 'Thanks @Ana');
  // Only the group's own people: no agents, Macro items or @here.
  await expect(page.getByText('+14155550199')).toBeVisible();
  await expect(page.getByText('@here')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('!');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => state.outgoing.length).toBe(1);
  expect(state.outgoing[0]).toMatchObject({
    message: {
      type: 'text',
      text: expect.stringMatching(/^Thanks @14155550199 ?!$/),
      mentions: ['14155550199@s.whatsapp.net'],
    },
  });
  expect(unexpected).toEqual([]);
});

test('history imported after adding shows up older, with the import state', async ({
  page,
}) => {
  const state = server();
  state.backfill = { state: 'waiting_for_phone', imported: 0 };
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  await expect(
    page.getByText('WhatsApp · Waiting for your phone to import history')
  ).toBeVisible();
  // The phone answers; the next read (push or fallback re-fetch) shows it.
  state.backfill = { state: 'done', imported: 1 };
  state.imported = [
    {
      ...incomingMessage,
      id: 'message-imported',
      body: 'From before the group was added',
      sent_at: '2026-10-19T10:00:00Z',
      reactions: [],
      attachments: [],
    },
  ];
  await expect(page.getByText('From before the group was added')).toBeVisible();
  await expect(page.getByText(/import history|Importing history/)).toHaveCount(
    0
  );
  const ids = await page
    .locator('[data-message-id]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-message-id'))
    );
  expect(ids.slice(0, 2)).toEqual(['message-imported', 'message-1']);
  expect(unexpected).toEqual([]);
});

test('a refused send leaves the conversation, says why and restores the draft', async ({
  page,
}) => {
  const state = server();
  state.sendReplies.push({
    status: 403,
    json: {
      code: 'forbidden',
      message: 'you do not have permission for this WhatsApp operation',
    },
  });
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  await typeInComposer(page, 'Not allowed here');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.getByText("Your WhatsApp can't send to this group.")
  ).toBeVisible();
  await expect(
    page.locator('[role="log"]').getByText('Not allowed here')
  ).toHaveCount(0);
  await expect(
    page.locator('[data-input-editor-shell]').getByText('Not allowed here')
  ).toBeVisible();
  expect(state.outgoing).toHaveLength(1);
  expect(unexpected).toEqual([]);
});

test('an unknown outcome retries quietly under the same key', async ({
  page,
}) => {
  const state = server();
  state.sendReplies.push({
    status: 503,
    json: {
      code: 'temporarily_unavailable',
      message: 'WhatsApp is temporarily unavailable; retry shortly',
    },
  });
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  await typeInComposer(page, 'Arrives once');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => state.outgoing.length).toBe(2);
  const [first, second] = state.outgoing as { idempotency_key: string }[];
  expect(second?.idempotency_key).toBe(first?.idempotency_key);
  await expect(page.getByText(/Couldn't reach WhatsApp/)).toHaveCount(0);
  await expect(
    page.locator('[role="log"]').getByText('Arrives once')
  ).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('a shared viewer can read without connecting WhatsApp', async ({
  page,
}) => {
  const state = server();
  state.canSend = false;
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  await expect(
    page.getByText('The updated designs are ready for review.', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Connect your WhatsApp to reply')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true })
  ).toHaveCount(0);
  expect(state.outgoing).toEqual([]);
  expect(unexpected).toEqual([]);
});

for (const mobile of [false, true]) {
  test.describe(`${mobile ? 'mobile' : 'desktop'} group`, () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    for (const dark of [false, true]) {
      test(`presentation ${dark ? 'dark' : 'light'}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
        const state = server();
        const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
        await expect(
          page.getByRole('textbox', {
            name: 'Message Design Crit as +14155550142',
          })
        ).toBeVisible();
        await expect(
          page.getByRole('textbox', { name: 'Message Design Crit' })
        ).toBeVisible();
        expect(await page.evaluate(() => innerWidth)).toBe(mobile ? 390 : 1440);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          )
        ).toBe(false);
        expect(
          await page.evaluate(() => document.documentElement.dataset.themeLight)
        ).toBe(String(!dark));
        const name = `group-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}.png`;
        await page.screenshot({
          path: process.env.WHATSAPP_SCREENSHOT_DIR
            ? join(process.env.WHATSAPP_SCREENSHOT_DIR, name)
            : test.info().outputPath(name),
          fullPage: true,
        });
        expect(unexpected).toEqual([]);
      });
    }
  });
}

test('opens the standard share dialog for the independent group entity', async ({
  page,
}) => {
  const state = server();
  state.canSend = false;
  state.sharedViewer = true;
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('Design Crit', { exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByRole('dialog')
      .getByText(/Only the owner can share access to this WhatsApp group/)
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Copy Link' })
  ).toBeVisible();
  expect(state.requests).toContain(
    `GET whatsapp-groups/${GROUP_ID}/permissions`
  );
  expect(unexpected).toEqual([]);
});

test('the owner shares through direct people access without creating a channel', async ({
  page,
}) => {
  const state = server();
  const unexpected = await mount(page, state, `?group=${GROUP_ID}`);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('textbox', { name: 'Macro email address' })
  ).toBeVisible();
  await dialog
    .getByRole('textbox', { name: 'Macro email address' })
    .fill('ana@example.test');
  await dialog.getByRole('button', { name: 'Add person' }).click();
  await expect
    .poll(() => state.grants)
    .toEqual([{ userId: 'macro|ana@example.test', accessLevel: 'view' }]);
  await expect(dialog.getByText('View access added.')).toBeVisible();
  expect(state.permissionUpdates).toEqual([]);
  expect(state.requests.some((request) => request.includes('/channels/'))).toBe(
    false
  );
  expect(unexpected).toEqual([]);
});
