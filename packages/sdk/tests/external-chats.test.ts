import { afterEach, expect, test } from 'bun:test';
import {
  ExternalChatMessage,
  ExternalChatParticipant,
  ExternalChatSend,
  ExternalChatUpload,
  Macro,
} from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const summary = {
  id: 'chat',
  provider: 'whatsapp',
  name: 'Support',
  kind: 'group',
  userId: 'owner',
  unreadCount: 1,
  lastMessageAt: '2026-10-21',
  canSend: true,
  sendReason: null,
  community: { id: '12036399@g.us', name: 'Neighbours', announcements: false },
};
const members = {
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
  members,
  disappearingSeconds: 604800,
  sendingIdentity: '15550000001@s.whatsapp.net',
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
  chatId: 'chat',
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
  return { macro, requests, chat: macro.externalChats.byId('chat') };
}

test('added chats can be listed without a provider connection and handles fetch standalone detail', async () => {
  const { macro, requests } = fixture((request) =>
    Response.json(
      new URL(request.url).pathname.endsWith('/external-chats')
        ? [summary]
        : detail,
    ),
  );
  const chats = await macro.externalChats.list();
  expect(chats[0].entityType).toBe('external_chat');
  expect(await chats[0].provider()).toBe('whatsapp');
  expect(await chats[0].name()).toBe('Support');
  expect(await chats[0].canSend()).toBe(true);
  expect(await chats[0].kind()).toBe('group');
  expect(await chats[0].disappearingSeconds()).toBe(604800);
  expect((await chats[0].community())?.name).toBe('Neighbours');
  expect((await chats[0].community())?.chat.id).toBe('12036399@g.us');
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/external-chats',
    '/external-chats/chat',
  ]);
  expect(JSON.stringify(chats[0])).not.toContain('owner-api-token');
});

test('timeline pagination is lazy and messages use their own chat-scoped handles', async () => {
  const { chat, requests } = fixture((request) =>
    Response.json(
      new URL(request.url).searchParams.has('before')
        ? { messages: [{ ...message, id: 'older' }], nextCursor: null }
        : { messages: [message], nextCursor: 'message' },
    ),
  );
  const iterator = chat.messages({ limit: 1 });
  expect(requests).toHaveLength(0);
  const first = await iterator.next();
  expect(first.value).toBeInstanceOf(ExternalChatMessage);
  expect(first.value && (await first.value.body())).toBe('hello');
  expect(requests).toHaveLength(1);
  await iterator.return(undefined);
  expect(requests).toHaveLength(1);
  const all = [];
  for await (const item of chat.messages({ limit: 1 })) all.push(item.id);
  expect(all).toEqual(['message', 'older']);
  expect(new URL(requests[2].url).searchParams.get('before')).toBe('message');
});

test('read cursors and permission changes use standalone routes and reject cross-chat messages', async () => {
  const { macro, chat, requests } = fixture(
    () => new Response(null, { status: 204 }),
  );
  await chat.markRead(ExternalChatMessage.byId(macro._client, chat, 'message'));
  expect(await requests[0].json()).toEqual({ messageId: 'message' });
  await chat.updatePermissions({ teamShareAccessLevel: 'view' });
  expect(requests[1].method).toBe('PATCH');
  expect(new URL(requests[1].url).pathname).toBe(
    '/external-chats/chat/permissions',
  );
  const other = macro.externalChats.byId('other');
  await expect(
    chat.markRead(ExternalChatMessage.byId(macro._client, other, 'message')),
  ).rejects.toThrow('another chat');
  expect(requests).toHaveLength(2);
});

test('owner-token send preserves intent and unknown delivery is read without resending', async () => {
  const { chat, requests } = fixture((request) =>
    Response.json(
      request.method === 'POST' &&
        new URL(request.url).pathname.endsWith('/sends')
        ? progress
        : [progress],
    ),
  );
  const sent = await chat.send(
    { type: 'text', text: 'hello' },
    { idempotencyKey: 'stable' },
  );
  expect(sent).toBeInstanceOf(ExternalChatSend);
  expect(sent.chat.id).toBe('chat');
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

test('staged uploads stay scoped to their chat and carry no credentials', async () => {
  const { macro, chat, requests } = fixture(() =>
    Response.json({
      uploadId: 'upload',
      filename: 'note.txt',
      kind: 'document',
    }),
  );
  const upload = await chat.upload(
    new File(['hello'], 'note.txt', { type: 'text/plain' }),
  );
  expect(upload).toBeInstanceOf(ExternalChatUpload);
  expect(upload.chat.id).toBe(chat.id);
  expect(new URL(requests[0].url).pathname).toBe(
    '/external-chats/chat/attachments',
  );
  expect(JSON.stringify(upload)).not.toContain('owner-api-token');
  const other = ExternalChatUpload.byId(
    macro.externalChats.byId('other'),
    'other-upload',
  );
  await expect(
    chat.send({ type: 'media', upload: other }, { idempotencyKey: 'stable' }),
  ).rejects.toThrow('another chat');
  expect(requests).toHaveLength(1);
});

test('mutations accept only messages of the same chat', async () => {
  const { macro, chat, requests } = fixture(() => Response.json(progress));
  const target = ExternalChatMessage.byId(macro._client, chat, 'message');
  await chat.send(
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

test("a text send mentions the chat's participants and refuses another chat's", async () => {
  const { macro, chat, requests } = fixture((request) =>
    Response.json(request.method === 'POST' ? progress : detail),
  );
  const [customer] = await chat.participants();
  expect(customer.displayName).toBe('Customer');
  expect(customer.mentionToken).toBe('15550001111');
  await chat.send(
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
  const stranger = ExternalChatParticipant.byId(
    macro.externalChats.byId('other'),
    '15550002222@s.whatsapp.net',
  );
  await expect(
    chat.send(
      { type: 'text', text: 'hi @15550002222', mentions: [stranger] },
      { idempotencyKey: 'stranger' },
    ),
  ).rejects.toThrow('another chat');
  expect(requests).toHaveLength(2);
});

test('a message handle reads only its own message', async () => {
  const { macro, chat, requests } = fixture(() => Response.json(message));
  const handle = ExternalChatMessage.byId(macro._client, chat, 'message');
  expect(await handle.body()).toBe('hello');
  expect(handle.chat.id).toBe('chat');
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/external-chats/chat/messages/message',
  ]);
});

test('sends, delivery and attachment states stay scoped to the chat', async () => {
  const { macro, chat, requests } = fixture((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/messages/attachments'))
      return Response.json([
        {
          messageId: 'message',
          attachments: [
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
  const [open] = await chat.sends();
  expect(open.id).toBe('intent');
  const target = ExternalChatMessage.byId(macro._client, chat, 'message');
  const delivered = await chat.delivery([open, target]);
  expect(delivered[0].id).toBe('intent');
  expect(await requests[1].json()).toEqual(['intent', 'message']);
  const [states] = await chat.messageAttachments([target]);
  expect(states.message.id).toBe('message');
  expect(states.attachments[0].url).toBe(
    'https://files.example.test/file/file',
  );
  const other = macro.externalChats.byId('other');
  await expect(
    chat.messageAttachments([
      ExternalChatMessage.byId(macro._client, other, 'message'),
    ]),
  ).rejects.toThrow('another chat');
  await expect(
    chat.delivery([ExternalChatSend.byId(macro._client, other, 'intent')]),
  ).rejects.toThrow('another chat');
  expect(requests).toHaveLength(3);
});

test('a send recovers its original intent as handles', async () => {
  const { macro, chat } = fixture(() =>
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
  const send = ExternalChatSend.byId(macro._client, chat, 'intent');
  const intent = await send.request();
  expect(intent.idempotencyKey).toBe('stable');
  expect(intent.replyTo?.id).toBe('quoted');
  expect(intent.replyTo?.chat.id).toBe('chat');
  if (intent.message.type !== 'text') throw new Error('expected text');
  expect(intent.message.mentions?.map((mention) => mention.id)).toEqual([
    '15550001111@s.whatsapp.net',
  ]);
});

test('remove stops syncing through the owner route', async () => {
  const { chat, requests } = fixture(() => new Response(null, { status: 204 }));
  await chat.remove();
  expect(requests[0].method).toBe('DELETE');
  expect(new URL(requests[0].url).pathname).toBe('/external-chats/chat');
});
