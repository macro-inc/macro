import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type {
  ExternalChatAdd,
  ExternalChatAdded,
  ExternalChatSendProgress,
  ExternalChatSendReply,
  ExternalChatUploadedAttachment,
  MarkRead,
  WhatsAppAccount,
  WhatsAppAccountView,
  WhatsAppDisconnect,
  WhatsAppPairing,
} from '../../src/lib/service-clients/service-storage/generated/schemas';

const USER_ID = 'macro|wa-tester@example.test';

/** One row of the account's WhatsApp chat list. */
type Chat = {
  jid: string;
  kind: 'group' | 'direct';
  name: string;
  lastActivityAt: string | null;
  added: { id: string; name: string } | null;
  shared?: { id: string; name: string; ownerId: string };
  /** The account's chat with itself. */
  self?: boolean;
  community?: { id: string; name: string; announcements: boolean };
};

/** Server state the mocked DSS `/whatsapp` and `/external-chats` routes answer from. */
type LinkedServer = {
  account: WhatsAppAccount | null;
  /** What a pairing reports unless `pairingStates` names it. */
  pairingState: string;
  pairingStates: Record<string, string>;
  /** Pairings started so far; `connect` numbers them `pairing-1`, `pairing-2`, … */
  connects: number;
  chats: Chat[];
  /** The added chat's history import, as `GET /external-chats/{id}` reports it. */
  backfill: { state: string; imported: number } | null;
  /** History the owner's phone sent so far, older than everything shown. */
  imported: unknown[];
  requests: string[];
  additions: ExternalChatAdd[];
  passkeyAnswers: unknown[];
  canSend: boolean;
  sharedViewer: boolean;
  outgoing: ExternalChatSendReply[];
  grants: { userId: string; accessLevel: string }[];
  permissionUpdates: unknown[];
  readMessages: string[];
  /** Responses for the next sends, in order; afterwards a send is recorded. */
  sendReplies: { status: number; json: unknown }[];
  /** Progress `POST /delivery` reports, by send id. */
  delivery: Record<
    string,
    Pick<ExternalChatSendProgress, 'state' | 'messageId'>
  >;
  /** What `POST /attachments` says it staged. */
  upload: Omit<ExternalChatUploadedAttachment, 'uploadId'>;
  /** Stored attachments' bytes, by static file id; others never load. */
  files: Record<string, { body: Buffer; contentType: string }>;
};

function server(): LinkedServer {
  return {
    account: null,
    pairingState: 'qr',
    pairingStates: {},
    connects: 0,
    backfill: null,
    imported: [],
    chats: [
      {
        jid: '14155550199@s.whatsapp.net',
        kind: 'direct',
        name: 'Ana Ruiz',
        lastActivityAt: '2026-10-21T10:00:00Z',
        added: null,
      },
      {
        jid: '120363001@g.us',
        kind: 'group',
        name: 'Design Crit',
        lastActivityAt: '2026-10-21T09:00:00Z',
        added: { id: CHAT_ID, name: 'design-crit' },
      },
      {
        jid: '120363003@g.us',
        kind: 'group',
        name: 'Launch War Room',
        lastActivityAt: '2026-10-20T09:00:00Z',
        added: null,
      },
      {
        jid: '120363004@g.us',
        kind: 'group',
        name: 'Ana, Ben, +2',
        lastActivityAt: null,
        added: null,
        shared: {
          id: 'group-shared-family',
          name: 'Ana, Ben, +2',
          ownerId: 'macro|owner@example.test',
        },
      },
      {
        jid: '14155550142@s.whatsapp.net',
        kind: 'direct',
        name: 'You',
        lastActivityAt: null,
        added: null,
        self: true,
      },
    ],
    requests: [],
    additions: [],
    passkeyAnswers: [],
    canSend: true,
    sharedViewer: false,
    outgoing: [],
    grants: [],
    permissionUpdates: [],
    readMessages: [],
    sendReplies: [],
    delivery: {},
    upload: { filename: 'design.pdf', kind: 'document' },
    files: {},
  };
}

const CHAT_ID = '019a061e-0000-7000-8000-000000000001';
const incomingMessage = {
  id: 'message-1',
  kind: 'message',
  mentions: [],
  forwarded: false,
  rich: null,
  sender: { name: 'Ana Ruiz', userId: null },
  body: 'The updated designs are ready for review.',
  sentAt: '2026-10-21T10:00:00Z',
  editedAt: null,
  deleted: false,
  replyTo: null,
  reactions: [{ emoji: '👍', count: 2, mine: false }],
  attachments: [
    {
      ordinal: 0,
      state: 'loading',
      fileName: 'design.pdf',
      fileId: null,
    },
  ],
  deliveryState: null,
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
    if (url.pathname.startsWith(`/dss/entities/external_chat/${CHAT_ID}`)) {
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
    if (/^\/dss\/(external-chats|whatsapp)(\/|$)/.test(url.pathname)) {
      const path = url.pathname.slice('/dss/'.length);
      const method = route.request().method();
      state.requests.push(`${method} ${path}`);
      if (path.startsWith(`external-chats/${CHAT_ID}`)) {
        const suffix = path.slice(`external-chats/${CHAT_ID}`.length);
        if (!suffix)
          return route.fulfill({
            json: {
              id: CHAT_ID,
              provider: 'whatsapp',
              kind: 'group',
              name: 'Design Crit',
              userId: state.sharedViewer ? 'macro|owner@example.test' : USER_ID,
              accessLevel: state.sharedViewer ? 'view' : 'owner',
              canSend: state.canSend,
              sendReason: state.canSend ? null : 'no_account',
              sendingIdentity: state.canSend
                ? '14155550142@s.whatsapp.net'
                : null,
              unreadCount: 1,
              backfill: state.backfill,
              members: {
                name: 'Design Crit',
                announce: false,
                observedAt: '2026-10-21T10:00:00Z',
                participants: [
                  {
                    jid: '14155550199@s.whatsapp.net',
                    alternateJid: null,
                    displayName: 'Ana Ruiz',
                    admin: true,
                  },
                ],
              },
              limits: {
                textLimitBytes: 65536,
                attachmentLimitBytes: 33554432,
                mutationWindowSeconds: 900,
                maxAttachments: 1,
                mutations: ['reaction', 'edit', 'delete'],
                attachmentTypes: ['image/png', 'application/pdf', 'audio/ogg'],
              },
            },
          });
        if (suffix === '/messages')
          return route.fulfill({
            json: {
              nextCursor: url.searchParams.has('before')
                ? null
                : 'older-cursor',
              messages: url.searchParams.has('before')
                ? [
                    {
                      ...incomingMessage,
                      id: 'message-0',
                      body: 'Previous day discussion',
                      sentAt: '2026-10-20T10:00:00Z',
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
                      sender: { name: 'Me', userId: USER_ID },
                      sentAt: new Date().toISOString(),
                      replyTo: 'message-1',
                      reactions: [],
                      attachments: [],
                      deliveryState: 'accepted',
                    },
                  ],
            },
          });
        if (suffix === '/sends' && method === 'POST') {
          const body: ExternalChatSendReply = route.request().postDataJSON();
          state.outgoing.push(body);
          const reply = state.sendReplies.shift();
          if (reply)
            return route.fulfill({ status: reply.status, json: reply.json });
          const id = `send-${body.idempotencyKey}`;
          state.delivery[id] ??= { state: 'pending', messageId: null };
          return route.fulfill({
            json: {
              id,
              chatId: CHAT_ID,
              userId: USER_ID,
              createdAt: new Date().toISOString(),
              payload: body,
              ...state.delivery[id],
            } satisfies ExternalChatSendProgress,
          });
        }
        if (suffix === '/delivery')
          return route.fulfill({
            json: (route.request().postDataJSON() as string[])
              .filter((id) => state.delivery[id])
              .map((id) => ({
                id,
                chatId: CHAT_ID,
                userId: USER_ID,
                createdAt: new Date().toISOString(),
                payload: {},
                ...state.delivery[id],
              })),
          });
        if (suffix === '/read') {
          const body: MarkRead = route.request().postDataJSON();
          state.readMessages.push(body.messageId);
          return route.fulfill({ json: {} });
        }
        if (suffix === '/attachments')
          return route.fulfill({
            json: {
              uploadId: 'upload-1',
              ...state.upload,
            } satisfies ExternalChatUploadedAttachment,
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
      if (url.pathname.startsWith(`/dss/entities/external_chat/${CHAT_ID}`))
        return route.fulfill({ json: {} });
      if (path === 'whatsapp/configuration')
        return route.fulfill({
          json: { pairing: true, adoption: true, sending: true },
        });
      if (path === 'external-chats' && method === 'GET')
        return route.fulfill({
          json: state.chats
            .filter((item) => item.added)
            .map((item) => ({
              id: item.added?.id,
              provider: 'whatsapp',
              kind: item.kind,
              name: item.added?.name,
              userId: USER_ID,
              unreadCount: item.added?.id === CHAT_ID ? 2 : 0,
              canSend: item.added?.id === CHAT_ID,
              sendReason: item.added?.id === CHAT_ID ? null : 'not_added',
              community: item.community ?? null,
            })),
        });
      if (path === 'external-chats' && method === 'POST') {
        const body: ExternalChatAdd = route.request().postDataJSON();
        state.additions.push(body);
        const chat = state.chats.find(({ jid }) => jid === body.remoteId);
        if (chat) chat.added = { id: 'chat-new', name: chat.name };
        return route.fulfill({
          json: { chatId: 'chat-new' } satisfies ExternalChatAdded,
        });
      }
      if (path === 'whatsapp/account')
        return route.fulfill({
          json: { account: state.account } satisfies WhatsAppAccountView,
        });
      if (path === 'whatsapp/connect')
        return route.fulfill({
          json: {
            id: `pairing-${++state.connects}`,
            accountId: 'account-1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            state: 'waiting',
          } satisfies WhatsAppPairing,
        });
      const pairing = /^whatsapp\/pairing\/(pairing-\d+)(\/passkey)?$/.exec(
        path
      );
      if (pairing && method === 'DELETE') return route.fulfill({ status: 204 });
      if (pairing?.[2]) {
        state.passkeyAnswers.push(route.request().postDataJSON());
        return route.fulfill({ status: 204 });
      }
      if (pairing) {
        const id = pairing[1] ?? '';
        const pairingState = state.pairingStates[id] ?? state.pairingState;
        if (pairingState === 'success')
          state.account = {
            id: 'account-1',
            userId: USER_ID,
            authorizationGeneration: 4,
            identityJid: '14155550142:3@s.whatsapp.net',
            state: 'connected',
          };
        return route.fulfill({
          headers: { 'Cache-Control': 'no-store' },
          json: {
            state: pairingState,
            qr: pairingState === 'qr' ? `2@ref-${id},noise,identity,adv` : null,
            challenge:
              pairingState === 'passkey'
                ? { challenge: 'Y2hhbGxlbmdl', rpId: 'whatsapp.com' }
                : null,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        });
      }
      if (path === 'whatsapp/chats' && method === 'GET')
        return route.fulfill({
          json: {
            chats: state.chats.map((chat) => ({
              ...chat,
              archived: false,
              pinned: false,
              shared: chat.added ? null : (chat.shared ?? null),
              community: chat.community ?? null,
              canAdd: !chat.self && !chat.added && !chat.shared,
              cannotAddReason: chat.self ? 'own_chat' : null,
            })),
          },
        });
      if (path === 'whatsapp/disconnect') {
        state.account = null;
        return route.fulfill({
          json: { remoteUnlinkRequested: true } satisfies WhatsAppDisconnect,
        });
      }
      return route.fulfill({ status: 404, json: {} });
    }
    // Chat's channel list feeds the composer's `@` menu; this account has none.
    if (url.pathname === '/dss/channels/activity')
      return route.fulfill({ json: [] });
    if (url.pathname === '/dss/comms/channels')
      return route.fulfill({ json: { items: [], next_cursor: null } });
    // Stored attachments are static files, like Chat's media.
    if (url.pathname.startsWith('/static-file/file/')) {
      const file = state.files[url.pathname.split('/').at(-1) ?? ''];
      // Unserved files stay loading, so their reserved shape shows.
      if (!file) return;
      return route.fulfill(file);
    }
    if (/^\/(auth|dss|notification|connection-gateway)\//.test(url.pathname))
      return route.fulfill({ json: {} });
    return route.fulfill({ response: await route.fetch() });
  });
  await page.goto(
    `${origin}/tests/functional/whatsapp-linked/index.html${query}`
  );
  return unexpected;
}

test('links WhatsApp by QR, then adds a shareable WhatsApp chat', async ({
  page,
}) => {
  const state = server();
  const unexpected = await mount(page, state);

  await page.getByRole('button', { name: 'Connect' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveClass(/ph-no-capture/);
  await expect(
    dialog.getByRole('img', {
      name: 'Scan this code with WhatsApp on your phone',
    })
  ).toBeVisible();

  state.pairingState = 'success';
  await expect(page.getByText('+14155550142')).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(state.requests).not.toContain('DELETE whatsapp/pairing/pairing-1');

  const groups = page.getByRole('list', { name: 'Groups' });
  await expect(groups.getByText('Launch War Room')).toBeVisible();
  await expect(groups.getByText('Design Crit')).toHaveCount(0);
  // Direct chats are added like groups; only the chat with yourself isn't.
  await expect(
    page
      .getByRole('list', { name: 'Direct messages' })
      .getByRole('listitem')
      .filter({ hasText: 'Ana Ruiz' })
      .getByText('Direct chat')
  ).toBeVisible();
  await page.getByRole('button', { name: /Can't be added \(1\)/ }).click();
  const self = page
    .getByRole('list', { name: "Can't be added" })
    .getByRole('listitem')
    .filter({ hasText: 'You' });
  await expect(
    self.getByText("Your chat with yourself can't be added")
  ).toBeVisible();
  await expect(self.getByRole('button')).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Search WhatsApp chats' });
  // While searching, your own added chats show in their section to open.
  await search.fill('design');
  await expect(
    groups
      .getByRole('listitem')
      .filter({ hasText: 'Design Crit' })
      .getByRole('button', { name: 'Open' })
  ).toBeVisible();
  await search.fill('launch');
  await expect(groups.getByRole('listitem')).toHaveCount(1);
  await search.fill('');
  await expect(groups.getByRole('listitem')).toHaveCount(2);
  await groups
    .getByRole('button', { name: /shared with you by Group Owner/i })
    .click();
  expect(await page.evaluate(() => window.openedChats)).toEqual([
    'group-shared-family',
  ]);

  await groups
    .getByRole('listitem')
    .filter({ hasText: 'Launch War Room' })
    .getByRole('button', { name: 'Add to Macro' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(groups.getByText('Launch War Room')).toHaveCount(0);
  expect(state.additions).toEqual([
    { provider: 'whatsapp', remoteId: '120363003@g.us', kind: 'group' },
  ]);
  expect(unexpected).toEqual([]);
});

test('a refused add says why, on that group', async ({ page }) => {
  const state = server();
  state.account = {
    id: 'account-1',
    userId: USER_ID,
    authorizationGeneration: 4,
    identityJid: '14155550142:3@s.whatsapp.net',
    state: 'connected',
  };
  const unexpected = await mount(page, state);
  // Registered last, so it answers before the catch-all mock.
  await page.route('**/dss/external-chats', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 409,
          json: {
            code: 'disconnected',
            message: 'connect your WhatsApp account first',
          },
        })
      : route.fallback()
  );
  const row = page
    .getByRole('list', { name: 'Groups' })
    .getByRole('listitem')
    .filter({ hasText: 'Launch War Room' });
  await row.getByRole('button', { name: 'Add to Macro' }).click();
  await expect(row.getByRole('alert')).toHaveText(
    'Your WhatsApp is disconnected. Reconnect it, then add the chat.'
  );
  expect(unexpected).toEqual([]);
});

test('External lists groups in Macro with unread counts and read-only tags', async ({
  page,
}) => {
  const state = server();
  state.chats[2].added = { id: 'group-shared', name: 'Launch War Room' };
  const unexpected = await mount(page, state, '?view=in-macro');
  const nav = page.getByRole('navigation', {
    name: 'WhatsApp chats in Macro',
  });
  const design = nav.getByRole('button', { name: /design-crit/ });
  await expect(design.getByLabel('2 unread messages')).toBeVisible();
  await expect(
    nav.getByRole('button', { name: /Launch War Room/ }).getByText('Read-only')
  ).toBeVisible();
  await design.click();
  expect(await page.evaluate(() => window.openedChats)).toEqual([CHAT_ID]);
  expect(unexpected).toEqual([]);
});

test('chats sort into direct messages, groups and communities on the page and in External', async ({
  page,
}) => {
  const state = server();
  state.account = {
    id: 'account-1',
    userId: USER_ID,
    authorizationGeneration: 4,
    identityJid: '14155550142:3@s.whatsapp.net',
    state: 'connected',
  };
  const neighbours = (announcements: boolean) => ({
    id: '120363000000000010@g.us',
    name: 'Neighbours',
    announcements,
  });
  state.chats.push(
    {
      jid: '120363011@g.us',
      kind: 'group',
      name: 'Neighbours',
      lastActivityAt: '2026-10-19T09:00:00Z',
      added: null,
      community: neighbours(true),
    },
    {
      jid: '120363012@g.us',
      kind: 'group',
      name: 'Garden',
      lastActivityAt: '2026-10-18T09:00:00Z',
      added: { id: 'group-garden', name: 'Garden' },
      community: neighbours(false),
    }
  );
  await mount(page, state);
  const rows = (label: string) =>
    page.getByRole('list', { name: label }).getByRole('listitem');
  await expect(rows('Direct messages')).toHaveText([/Ana Ruiz/]);
  await expect(rows('Groups')).toHaveText([/Launch War Room/, /Ana, Ben/]);
  // Garden is already in Macro; its announcements are not.
  await expect(rows('Neighbours')).toHaveText([/^Announcements/]);
  // Folding a section is remembered across reloads.
  const groupsHeading = page.getByRole('button', {
    name: 'Groups',
    exact: true,
  });
  await groupsHeading.click();
  await expect(groupsHeading).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(rows('Direct messages')).toHaveText([/Ana Ruiz/]);
  await expect(
    page.getByRole('button', { name: 'Groups', exact: true })
  ).toHaveAttribute('aria-expanded', 'false');

  const here = new URL(page.url());
  await page.goto(`${here.origin}${here.pathname}?view=in-macro`);
  const nav = page.getByRole('navigation', {
    name: 'WhatsApp chats in Macro',
  });
  await expect(
    nav.getByRole('navigation', { name: 'Groups' }).getByRole('button')
  ).toHaveText([/design-crit/]);
  await expect(
    nav.getByRole('navigation', { name: 'Neighbours' }).getByRole('button')
  ).toHaveText([/Garden/]);
  await nav.getByRole('button', { name: 'Garden' }).click();
  expect(await page.evaluate(() => window.openedChats)).toContain(
    'group-garden'
  );
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
  await expect
    .poll(() => state.requests)
    .toContain('DELETE whatsapp/pairing/pairing-1');
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
});

test('an expired code rolls to a new pairing on its own', async ({ page }) => {
  const state = server();
  await mount(page, state);

  await page.getByRole('button', { name: 'Connect' }).click();
  const dialog = page.getByRole('dialog');
  const code = dialog.getByRole('img', { name: /Scan this code/ });
  await expect(code).toBeVisible();
  const first = await code.innerHTML();

  state.pairingStates['pairing-1'] = 'expired';
  await expect.poll(() => state.connects).toBe(2);
  await expect(code).toBeVisible();
  await expect.poll(() => code.innerHTML()).not.toBe(first);
  await expect(dialog.getByText('Code expired')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(state.requests).not.toContain('DELETE whatsapp/pairing/pairing-2');
});

test('after a few codes without a scan, the dialog asks for a click', async ({
  page,
}) => {
  const state = server();
  state.pairingState = 'expired';
  await mount(page, state);

  await page.getByRole('button', { name: 'Connect' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Code expired')).toBeVisible();
  // The first code plus three automatic ones.
  expect(state.connects).toBe(4);
  await expect(dialog.getByText('Tap Link a device')).toBeVisible();

  state.pairingState = 'qr';
  await dialog.getByRole('button', { name: 'Show a new code' }).click();
  await expect(
    dialog.getByRole('img', { name: /Scan this code/ })
  ).toBeVisible();
  expect(state.connects).toBe(5);
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
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
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
    replyTo: 'message-1',
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
      messageId: 'message-1',
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
    fileName: id,
    mime,
    size: 1024,
    fileId: `file-${id}`,
    width: null,
    height: null,
    durationSeconds: null,
    presentation: null,
    ...extra,
  });
  return [
    {
      ...base,
      id: 'type-system',
      kind: 'system',
      sentAt: at(1),
      rich: {
        type: 'system',
        action: 'participants_added',
        actor: { name: 'Ana Ruiz', userId: null },
        participants: [{ name: '+1 555 0100', userId: null }],
        value: null,
        call: null,
      },
    },
    {
      ...base,
      id: 'type-mention',
      sentAt: at(2),
      forwarded: true,
      body: 'Ping @15550001111 about https://example.com',
      mentions: [{ token: '15550001111', name: 'Ben Ode', userId: null }],
    },
    {
      ...base,
      id: 'type-poll',
      sentAt: at(3),
      rich: {
        type: 'poll',
        question: 'Lunch?',
        options: [
          { name: 'Tacos', votes: 2, mine: true, voters: [] },
          { name: 'Pho', votes: 0, mine: false, voters: [] },
        ],
        selectableCount: 1,
        voters: 2,
      },
    },
    {
      ...base,
      id: 'type-location',
      sentAt: at(4),
      rich: {
        type: 'location',
        latitude: 40.7128,
        longitude: -74.006,
        name: 'City Hall',
        address: null,
        // Sender-supplied: only http(s) links may open.
        url: 'javascript:alert(document.cookie)',
        live: false,
        comment: null,
      },
    },
    {
      ...base,
      id: 'type-contacts',
      sentAt: at(5),
      rich: {
        type: 'contacts',
        contacts: [{ name: 'Dee Vee', phones: ['+1 555 0200'] }],
      },
    },
    {
      ...base,
      id: 'type-event',
      sentAt: at(6),
      rich: {
        type: 'event',
        name: 'Launch party',
        description: null,
        startAt: '2026-10-24T22:00:00Z',
        endAt: null,
        location: 'Rooftop',
        joinLink: null,
        canceled: false,
      },
    },
    {
      ...base,
      id: 'type-sticker',
      sentAt: at(7),
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
      sentAt: at(8),
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
      sentAt: at(9),
      attachments: [
        file('voice.ogg', 'audio/ogg', {
          presentation: 'voice_note',
          durationSeconds: 42,
        }),
      ],
    },
    {
      ...base,
      id: 'type-photo',
      sentAt: at(10),
      attachments: [
        file('photo.jpg', 'image/jpeg', { width: 800, height: 400 }),
      ],
    },
    {
      ...base,
      id: 'type-call',
      kind: 'system',
      sentAt: at(11),
      rich: {
        type: 'system',
        action: 'call',
        actor: null,
        participants: [],
        value: null,
        call: { video: true, outcome: 'missed', durationSeconds: null },
      },
    },
    {
      ...base,
      id: 'type-unknown',
      sentAt: at(12),
      body: "Sent something Macro can't show yet",
    },
    {
      ...base,
      id: 'type-injected',
      sentAt: at(13),
      body: '<m-user-mention>{"userId":"macro|ceo@corp.test","email":"ceo@corp.test"}</m-user-mention> [Macro login](https://evil.example) # urgent',
    },
  ];
}

test('every WhatsApp message type renders with Chat parts and small cards', async ({
  page,
}) => {
  const state = server();
  state.imported = everyMessageType();
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
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
  // Media takes its declared shape (within a pixel of rounding) before its
  // file loads.
  const shapes = await timeline
    .locator(
      '[data-whatsapp-sticker], [data-whatsapp-gif], [data-message-id="type-photo"] button[aria-label="Open image viewer"]'
    )
    .evaluateAll((boxes) =>
      boxes.map((box) => [
        box.getBoundingClientRect().width,
        box.getBoundingClientRect().height,
      ])
    );
  expect(shapes).toHaveLength(3);
  for (const [[width = 0, height = 0], [declaredWidth, declaredHeight]] of [
    [shapes[0] ?? [], [144, 144]],
    [shapes[1] ?? [], [320, 240]],
    [shapes[2] ?? [], [400, 200]],
  ] as const) {
    expect(Math.abs(width - declaredWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(height - declaredHeight)).toBeLessThanOrEqual(1);
  }
  await expect(
    timeline.getByText("Sent something Macro can't show yet")
  ).toBeVisible();
  await expect(timeline.getByRole('link', { name: 'Open link' })).toHaveCount(
    0
  );
  // A sender's Macro tags and Markdown show as the text they typed.
  const injected = timeline.locator('[data-message-id="type-injected"]');
  await expect(injected).toContainText(
    '<m-user-mention>{"userId":"macro|ceo@corp.test","email":"ceo@corp.test"}</m-user-mention> [Macro login](https://evil.example) # urgent'
  );
  await expect(injected.getByRole('link', { name: 'Macro login' })).toHaveCount(
    0
  );
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
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('an image sent from Macro shows at once and stays one image once stored', async ({
  page,
}) => {
  const state = server();
  state.upload = { filename: 'photo.png', kind: 'image' };
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
  const timeline = page.getByRole('log', { name: 'WhatsApp messages' });
  await page
    .locator('[data-input] input[type="file"]')
    .first()
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  const send = page.getByRole('button', { name: 'Send message' });
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => state.outgoing.length).toBe(1);
  expect(state.outgoing[0]).toMatchObject({
    message: { type: 'media', uploadId: 'upload-1' },
  });
  // The local preview, before WhatsApp has it; no file chip.
  await expect(timeline.locator('img[src^="blob:"]').first()).toBeAttached();
  await expect(timeline.getByText(/Loading photo\.png/)).toHaveCount(0);
  const sendId = Object.keys(state.delivery)[0] ?? '';
  state.imported = [
    {
      ...incomingMessage,
      id: 'message-sent',
      body: '',
      sender: { name: 'Me', userId: USER_ID },
      sentAt: new Date(Date.now() + 1000).toISOString(),
      reactions: [],
      attachments: [
        {
          ordinal: 0,
          state: 'ready',
          fileName: 'photo.png',
          mime: 'image/png',
          size: PNG.length,
          fileId: 'file-sent',
          width: null,
          height: null,
          durationSeconds: null,
          presentation: null,
        },
      ],
    },
  ];
  state.files['file-sent'] = { body: PNG, contentType: 'image/png' };
  state.delivery[sendId] = { state: 'accepted', messageId: 'message-sent' };
  await expect(
    timeline.locator('[data-message-id="message-sent"]')
  ).toBeVisible();
  // One image: the pending row gave way to the stored message.
  await expect(
    timeline.getByRole('button', { name: 'Open image viewer' })
  ).toHaveCount(1);
  await expect(
    timeline
      .locator('[data-message-id="message-sent"]')
      .getByRole('button', { name: 'Open image viewer' })
  ).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('history imported after adding shows up older, with the import state', async ({
  page,
}) => {
  const state = server();
  state.backfill = { state: 'waiting_for_phone', imported: 0 };
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
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
      sentAt: '2026-10-19T10:00:00Z',
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
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
  await typeInComposer(page, 'Not allowed here');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.getByText("Your WhatsApp can't send to this chat.")
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
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
  await typeInComposer(page, 'Arrives once');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => state.outgoing.length).toBe(2);
  const [first, second] = state.outgoing;
  expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
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
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
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
        const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
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

for (const mobile of [false, true]) {
  test.describe(`${mobile ? 'mobile' : 'desktop'} details`, () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    test('members, sharing and syncing open in the side panel', async ({
      page,
    }) => {
      const state = server();
      const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
      await expect(
        page.getByRole('textbox', { name: 'Message Design Crit' })
      ).toBeVisible();
      await page
        .getByRole('button', { name: mobile ? 'Show details' : /side panel/i })
        .click();
      const members = page.getByRole('list', { name: 'WhatsApp members' });
      await expect(members).toBeVisible();
      await expect(members.getByRole('listitem')).toHaveText([
        /Ana Ruiz\+14155550199Admin/,
      ]);
      await expect(page.getByRole('button', { name: 'Share…' })).toBeVisible();
      await page.getByRole('button', { name: 'Stop syncing' }).click();
      await page
        .getByLabel('Stop syncing this chat?')
        .getByRole('button', { name: 'Stop syncing' })
        .click();
      await expect
        .poll(() => state.requests)
        .toContain(`DELETE external-chats/${CHAT_ID}`);
      await expect(
        page.getByText('Syncing stopped. Its history stays in Macro.')
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        )
      ).toBe(false);
      expect(unexpected).toEqual([]);
    });
  });
}

test('opens the standard share dialog for the independent group entity', async ({
  page,
}) => {
  const state = server();
  state.canSend = false;
  state.sharedViewer = true;
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('Design Crit', { exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByRole('dialog')
      .getByText(/Only the owner can share access to this chat/)
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Copy Link' })
  ).toBeVisible();
  expect(state.requests).toContain(`GET external-chats/${CHAT_ID}/permissions`);
  expect(unexpected).toEqual([]);
});

test('the owner shares through direct people access without creating a channel', async ({
  page,
}) => {
  const state = server();
  const unexpected = await mount(page, state, `?chat=${CHAT_ID}`);
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
