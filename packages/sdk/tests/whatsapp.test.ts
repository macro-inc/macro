import { afterEach, expect, test } from 'bun:test';
import {
  Macro,
  WhatsAppChat,
  WhatsAppMessage,
  WhatsAppParticipant,
  WhatsAppSend,
  WhatsAppUpload,
} from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const account = {
  id: 'account',
  userId: 'owner',
  state: 'connected',
  identityJid: '15550000001@s.whatsapp.net',
  authorizationGeneration: 1,
};
const summary = {
  id: 'group',
  name: 'Support',
  kind: 'group',
  userId: 'owner',
  unreadCount: 1,
  lastMessageAt: '2026-10-21',
  canSend: true,
  sendReason: null,
};
const remote = { jid: '12036301@g.us' };
const roster = {
  name: 'Remote support',
  observedAt: '2026-10-21',
  announce: false,
  participants: [
    {
      jid: '15550001111@s.whatsapp.net',
      alternateJid: null,
      displayName: 'Customer',
      admin: false,
    },
  ],
};
const detail = {
  ...summary,
  roster,
  disappearingSeconds: 604800,
  community: { id: '12036399@g.us', name: 'Neighbours', announcements: false },
  sendingIdentity: account.identityJid,
  accessLevel: 'owner',
  sharePermission: {
    id: 'permission',
    owner: 'owner',
    linkShare: null,
    teamShareAccessLevel: null,
  },
  limits: {
    textLimitBytes: 16384,
    mutationWindowSeconds: 600,
    maxAttachments: 1,
    attachmentLimitBytes: 33554432,
    attachmentTypes: ['text/plain'],
    mutations: ['reaction', 'edit', 'delete'],
  },
};
const progress = {
  id: 'intent',
  groupId: 'group',
  userId: 'owner',
  state: 'unknown',
  messageId: null,
  errorCode: null,
  createdAt: '2026-10-21',
  payload: {
    idempotencyKey: 'stable',
    message: { type: 'text', text: 'hello' },
  },
};
const message = {
  id: 'message',
  sender: { personId: 'person', userId: null, name: 'Customer' },
  body: 'hello',
  replyTo: null,
  sentAt: '2026-10-21',
  receivedAt: '2026-10-21',
  editedAt: null,
  deleted: false,
  reactions: [],
  attachments: [],
  deliveryState: null,
};

function fixture(handler: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request.clone());
    return handler(request);
  }) as typeof fetch;
  const macro = new Macro({
    token: 'owner-api-token',
    hosts: {
      storage: 'https://storage.example.test',
      'static-files': 'https://files.example.test',
    },
  });
  return { macro, requests, group: macro.whatsapp.byId('group') };
}

test('shared groups can be listed without a WhatsApp connection and handles fetch standalone detail', async () => {
  const { macro, requests } = fixture((request) =>
    Response.json(
      new URL(request.url).pathname.endsWith('/whatsapp-groups')
        ? [summary]
        : detail,
    ),
  );
  const groups = await macro.whatsapp.groups();
  expect(groups[0].entityType).toBe('whatsapp_group');
  expect(await groups[0].name()).toBe('Support');
  expect(await groups[0].canSend()).toBe(true);
  expect(await groups[0].kind()).toBe('group');
  expect(await groups[0].disappearingSeconds()).toBe(604800);
  expect((await groups[0].community())?.name).toBe('Neighbours');
  expect((await groups[0].community())?.chat.id).toBe('12036399@g.us');
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/meta/linked/whatsapp-groups',
    '/meta/linked/whatsapp-groups/group',
  ]);
  expect(JSON.stringify(groups[0])).not.toContain('owner-api-token');
});

test('the chat list shows a group someone else shared instead of adding it again', async () => {
  const { macro } = fixture(() =>
    Response.json({
      chats: [
        {
          jid: remote.jid,
          kind: 'group',
          name: 'Remote support',
          lastActivityAt: null,
          archived: false,
          pinned: false,
          group: null,
          shared: {
            id: 'theirs',
            name: 'Remote support',
            ownerId: 'macro|ana@example.com',
          },
          canAdd: false,
          cannotAddReason: null,
          community: null,
        },
        {
          jid: '12036399@g.us',
          kind: 'group',
          name: 'Neighbours',
          lastActivityAt: null,
          archived: false,
          pinned: false,
          group: null,
          shared: null,
          canAdd: false,
          cannotAddReason: 'community',
          community: null,
        },
      ],
    }),
  );
  const [shared, community] = await macro.whatsapp.chats();
  expect(await shared.group()).toBeUndefined();
  expect((await shared.shared())?.id).toBe('theirs');
  expect(await community.cannotAddReason()).toBe('community');
});

test('the chat list lists groups and direct chats and adds a group by its handle', async () => {
  const { macro, requests } = fixture((request) =>
    Response.json(
      request.method === 'POST'
        ? { groupId: 'group' }
        : {
            chats: [
              {
                jid: '15558880001@s.whatsapp.net',
                kind: 'direct',
                name: 'Customer',
                lastActivityAt: '2026-10-22T10:00:00Z',
                archived: false,
                pinned: true,
                group: null,
                shared: null,
                canAdd: true,
                cannotAddReason: null,
                community: null,
              },
              {
                jid: remote.jid,
                kind: 'group',
                name: 'Remote support',
                lastActivityAt: null,
                archived: false,
                pinned: false,
                group: null,
                shared: null,
                canAdd: true,
                cannotAddReason: null,
                community: {
                  id: '12036399@g.us',
                  name: 'Neighbours',
                  announcements: false,
                },
              },
            ],
          },
    ),
  );
  const [direct, group] = await macro.whatsapp.chats();
  expect(await direct.kind()).toBe('direct');
  expect(await direct.canAdd()).toBe(true);
  expect(await group.canAdd()).toBe(true);
  expect((await group.community())?.name).toBe('Neighbours');
  expect((await group.community())?.chat.id).toBe('12036399@g.us');
  expect(await direct.community()).toBeUndefined();
  const adopted = await group.adopt();
  expect(adopted.id).toBe('group');
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/meta/linked/chats',
    '/meta/linked/groups/adopt',
  ]);
  expect(await requests[1].json()).toEqual({ groupJid: remote.jid });
});

test('account access stays owner-scoped and no account normalizes to undefined', async () => {
  let current: unknown = { account: null };
  const { macro } = fixture(() => Response.json(current));
  expect(await macro.whatsapp.account()).toBeUndefined();
  current = { account };
  expect((await macro.whatsapp.account())?.id).toBe('account');
});

test('timeline pagination is lazy and messages use their own group-scoped handles', async () => {
  const { group, requests } = fixture((request) =>
    Response.json(
      new URL(request.url).searchParams.has('before')
        ? { messages: [{ ...message, id: 'older' }], nextCursor: null }
        : { messages: [message], nextCursor: 'message' },
    ),
  );
  const iterator = group.messages({ limit: 1 });
  expect(requests).toHaveLength(0);
  const first = await iterator.next();
  expect(first.value).toBeInstanceOf(WhatsAppMessage);
  expect(first.value && (await first.value.body())).toBe('hello');
  expect(requests).toHaveLength(1);
  await iterator.return(undefined);
  expect(requests).toHaveLength(1);
  const all = [];
  for await (const item of group.messages({ limit: 1 })) all.push(item.id);
  expect(all).toEqual(['message', 'older']);
  expect(new URL(requests[2].url).searchParams.get('before')).toBe('message');
});

test('read cursors and permission changes use standalone routes and reject cross-group messages', async () => {
  const { macro, group, requests } = fixture(
    () => new Response(null, { status: 204 }),
  );
  await group.markRead(WhatsAppMessage.byId(macro._client, group, 'message'));
  expect(await requests[0].json()).toEqual({ messageId: 'message' });
  await group.updatePermissions({ teamShareAccessLevel: 'view' });
  expect(requests[1].method).toBe('PATCH');
  expect(new URL(requests[1].url).pathname).toBe(
    '/meta/linked/whatsapp-groups/group/permissions',
  );
  const other = macro.whatsapp.byId('other');
  await expect(
    group.markRead(WhatsAppMessage.byId(macro._client, other, 'message')),
  ).rejects.toThrow('another group');
  expect(requests).toHaveLength(2);
});

test('owner-token send preserves intent and unknown delivery is read without resending', async () => {
  const { group, requests } = fixture((request) =>
    Response.json(
      request.method === 'POST' &&
        new URL(request.url).pathname.endsWith('/sends')
        ? progress
        : [progress],
    ),
  );
  const sent = await group.reply(
    { type: 'text', text: 'hello' },
    { idempotencyKey: 'stable' },
  );
  expect(sent).toBeInstanceOf(WhatsAppSend);
  expect(sent.group.id).toBe('group');
  expect(await sent.state()).toBe('unknown');
  expect(await requests[0].json()).toEqual({
    idempotencyKey: 'stable',
    message: { type: 'text', text: 'hello', mentions: [] },
  });
  await sent.refresh();
  expect(await sent.state()).toBe('unknown');
  expect(
    requests.filter(
      (request) =>
        new URL(request.url).pathname.endsWith('/sends') &&
        request.method === 'POST',
    ),
  ).toHaveLength(1);
});

test('staged uploads stay scoped to their adopted group and carry no credentials', async () => {
  const { macro, group, requests } = fixture(() =>
    Response.json({
      uploadId: 'upload',
      filename: 'note.txt',
      kind: 'document',
    }),
  );
  const upload = await group.upload(
    new File(['hello'], 'note.txt', { type: 'text/plain' }),
  );
  expect(upload).toBeInstanceOf(WhatsAppUpload);
  expect(upload.group.id).toBe(group.id);
  expect(JSON.stringify(upload)).not.toContain('owner-api-token');
  const other = WhatsAppUpload.byId(
    macro.whatsapp.byId('other'),
    'other-upload',
  );
  await expect(
    group.reply({ type: 'media', upload: other }, { idempotencyKey: 'stable' }),
  ).rejects.toThrow('another group');
  expect(requests).toHaveLength(1);
});

test('mutations and replies accept only standalone WhatsApp messages', async () => {
  const { macro, group, requests } = fixture(() => Response.json(progress));
  const target = WhatsAppMessage.byId(macro._client, group, 'message');
  await group.reply(
    { type: 'mutation', message: target, operation: 'reaction', text: '👍' },
    { idempotencyKey: 'reaction' },
  );
  expect(await requests[0].json()).toEqual({
    idempotencyKey: 'reaction',
    message: {
      type: 'mutation',
      messageId: 'message',
      operation: 'reaction',
      text: '👍',
    },
  });
});

test("a text reply mentions roster participants and refuses another chat's", async () => {
  const { macro, group, requests } = fixture((request) =>
    Response.json(request.method === 'POST' ? progress : detail),
  );
  const [customer] = await group.participants();
  expect(customer.displayName).toBe('Customer');
  expect(customer.mentionToken).toBe('15550001111');
  await group.reply(
    { type: 'text', text: 'hi @15550001111', mentions: [customer] },
    { idempotencyKey: 'mention' },
  );
  expect(await requests[1].json()).toEqual({
    idempotencyKey: 'mention',
    message: {
      type: 'text',
      text: 'hi @15550001111',
      mentions: ['15550001111@s.whatsapp.net'],
    },
  });
  const stranger = WhatsAppParticipant.byId(
    macro.whatsapp.byId('other'),
    '15550002222@s.whatsapp.net',
  );
  await expect(
    group.reply(
      { type: 'text', text: 'hi @15550002222', mentions: [stranger] },
      { idempotencyKey: 'stranger' },
    ),
  ).rejects.toThrow('another group');
  expect(requests).toHaveLength(2);
});

test('a message handle reads only its own message', async () => {
  const { macro, group, requests } = fixture(() => Response.json(message));
  const handle = WhatsAppMessage.byId(macro._client, group, 'message');
  expect(await handle.body()).toBe('hello');
  expect(handle.group.id).toBe('group');
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/meta/linked/whatsapp-groups/group/messages/message',
  ]);
});

test('a chat handle reads its entry from the chat list', async () => {
  const { macro, requests } = fixture(() =>
    Response.json({
      chats: [
        {
          jid: remote.jid,
          kind: 'group',
          name: 'Remote support',
          lastActivityAt: null,
          archived: false,
          pinned: false,
          group: { id: 'group', name: 'Remote support' },
          shared: null,
          canAdd: false,
          cannotAddReason: null,
          community: null,
        },
      ],
    }),
  );
  const chat = WhatsAppChat.byId(macro._client, remote.jid);
  expect((await chat.group())?.id).toBe('group');
  expect(new URL(requests[0].url).pathname).toBe('/meta/linked/chats');
  await expect(
    WhatsAppChat.byId(macro._client, 'missing@g.us').name(),
  ).rejects.toThrow('not available');
});

test('sends, delivery and attachment states stay scoped to the chat', async () => {
  const { macro, group, requests } = fixture((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/messages/attachments'))
      return Response.json([
        {
          messageId: 'message',
          linkedAttachments: [
            {
              ordinal: 0,
              state: 'ready',
              fileName: 'note.txt',
              mime: 'text/plain',
              size: 5,
              fileId: 'file',
            },
          ],
        },
      ]);
    return Response.json([progress]);
  });
  const [open] = await group.sends();
  expect(open.id).toBe('intent');
  const target = WhatsAppMessage.byId(macro._client, group, 'message');
  const delivered = await group.delivery([open, target]);
  expect(delivered[0].id).toBe('intent');
  expect(await requests[1].json()).toEqual(['intent', 'message']);
  const [states] = await group.messageAttachments([target]);
  expect(states.message.id).toBe('message');
  expect(states.attachments[0].url).toBe(
    'https://files.example.test/file/file',
  );
  const other = macro.whatsapp.byId('other');
  await expect(
    group.messageAttachments([
      WhatsAppMessage.byId(macro._client, other, 'message'),
    ]),
  ).rejects.toThrow('another group');
  await expect(
    group.delivery([WhatsAppSend.byId(macro._client, other, 'intent')]),
  ).rejects.toThrow('another group');
  expect(requests).toHaveLength(3);
});

test('a send recovers its original intent as handles', async () => {
  const { macro, group } = fixture(() =>
    Response.json([
      {
        ...progress,
        payload: {
          idempotencyKey: 'stable',
          replyTo: 'quoted',
          message: {
            type: 'text',
            text: 'hi @15550001111',
            mentions: ['15550001111@s.whatsapp.net'],
          },
        },
      },
    ]),
  );
  const send = WhatsAppSend.byId(macro._client, group, 'intent');
  const intent = await send.request();
  expect(intent.idempotencyKey).toBe('stable');
  expect(intent.replyTo?.id).toBe('quoted');
  expect(intent.replyTo?.group.id).toBe('group');
  if (intent.message.type !== 'text') throw new Error('expected text');
  expect(intent.message.mentions?.map((mention) => mention.id)).toEqual([
    '15550001111@s.whatsapp.net',
  ]);
});

test('detach stops syncing through the owner route', async () => {
  const { group, requests } = fixture(
    () => new Response(null, { status: 204 }),
  );
  await group.detach();
  expect(requests[0].method).toBe('DELETE');
  expect(new URL(requests[0].url).pathname).toBe(
    '/meta/linked/whatsapp-groups/group',
  );
});
