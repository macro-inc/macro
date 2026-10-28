import type {
  ExternalChatDetail,
  ExternalChatMessage,
  ExternalChatMessages,
} from '@service-storage/generated/schemas';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { externalChatApi } from './production-api';

const client = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  messages: vi.fn(),
  delivery: vi.fn(),
  send: vi.fn(),
  upload: vi.fn(),
  markRead: vi.fn(),
  stopSync: vi.fn(),
}));
vi.mock('@service-storage/external-chats', () => ({
  externalChatsClient: client,
}));
beforeEach(() => vi.clearAllMocks());

it('decodes shared viewing separately from the callers own sending account and handles absent members', async () => {
  const detail = {
    id: '019a061e-0000-7000-8000-000000000001',
    provider: 'whatsapp',
    kind: 'group',
    name: 'Shared group',
    userId: 'macro|owner@example.test',
    unreadCount: 3,
    lastMessageAt: null,
    canSend: false,
    sendReason: 'no_account',
    accessLevel: 'view',
    sendingIdentity: null,
    members: null,
    sharePermission: {
      id: 'share-1',
      owner: 'macro|owner@example.test',
      channelSharePermissions: [],
    },
    limits: {
      textLimitBytes: 65536,
      attachmentLimitBytes: 33554432,
      maxAttachments: 1,
      mutations: ['reaction', 'edit', 'delete'],
      mutationWindowSeconds: 900,
      attachmentTypes: ['image/png', 'application/pdf'],
    },
  } satisfies ExternalChatDetail;
  client.detail.mockResolvedValue(ok(detail));
  const chat = await externalChatApi.detail(detail.id);
  expect(chat.provider).toBe('whatsapp');
  expect(chat.ownerId).toBe('macro|owner@example.test');
  expect(chat.accessLevel).toBe('view');
  expect(chat.canSend).toBe(false);
  expect(chat.phone).toBeUndefined();
  expect(chat.members).toEqual([]);
  expect(chat.limits.attachmentTypes).toEqual(['image/png', 'application/pdf']);
});

it('decodes pagination, deleted flags, reaction ownership and attachment states from the independent timeline', async () => {
  const page = {
    nextCursor: '019a061e-0000-7000-8000-000000000002',
    messages: [
      {
        id: '019a061e-0000-7000-8000-000000000003',
        kind: 'message',
        sender: { personId: 'person-1', userId: null, name: 'Ana Ruiz' },
        body: '',
        mentions: [],
        forwarded: false,
        viewOnce: false,
        rich: null,
        replyTo: null,
        sentAt: '2026-10-21T12:00:00Z',
        receivedAt: '2026-10-21T12:00:01Z',
        editedAt: null,
        deleted: true,
        reactions: [{ emoji: '👍', count: 2, mine: true }],
        attachments: [
          {
            ordinal: 0,
            state: 'unsupported',
            fileName: 'drawing.psd',
            mime: 'image/vnd.adobe.photoshop',
            size: 1024,
            fileId: null,
          },
        ],
        deliveryState: null,
      },
    ],
  } satisfies ExternalChatMessages;
  client.messages.mockResolvedValue(ok(page));
  const result = await externalChatApi.messages('chat-id', 'before-id');
  expect(client.messages).toHaveBeenCalledWith('chat-id', 'before-id');
  expect(result.before).toBe(page.nextCursor);
  expect(result.messages[0]).toMatchObject({
    deleted: true,
    sender: { name: 'Ana Ruiz' },
    reactions: [{ emoji: '👍', count: 2, mine: true }],
    attachments: [
      { state: 'unsupported', fileName: 'drawing.psd', fileId: undefined },
    ],
  });
});

it('decodes mentions, forwarding, media presentation and every rich type, keeping only http(s) links', async () => {
  const base: Omit<ExternalChatMessage, 'id'> = {
    sender: { personId: 'person-1', userId: null, name: 'Ana Ruiz' },
    body: '',
    replyTo: null,
    sentAt: '2026-10-21T12:00:00Z',
    receivedAt: '2026-10-21T12:00:01Z',
    editedAt: null,
    deleted: false,
    reactions: [],
    attachments: [],
    deliveryState: null,
    kind: 'message',
    mentions: [],
    forwarded: false,
    viewOnce: false,
    rich: null,
  };
  const page = {
    nextCursor: null,
    messages: [
      {
        ...base,
        id: 'mention',
        body: 'Hi @15550001111 and @15550002222',
        forwarded: true,
        mentions: [
          { token: '15550001111', name: 'Ben', userId: 'macro|ben@x.test' },
          { token: '15550002222', name: '+1 555-000-2222', userId: null },
        ],
      },
      {
        ...base,
        id: 'sticker',
        attachments: [
          {
            ordinal: 0,
            state: 'ready',
            fileName: 'sticker.webp',
            mime: 'image/webp',
            size: 2048,
            fileId: 'file-1',
            width: 512,
            height: 512,
            durationSeconds: null,
            presentation: 'sticker',
          },
        ],
      },
      {
        ...base,
        id: 'poll',
        rich: {
          type: 'poll',
          question: 'Lunch?',
          options: [
            {
              name: 'Tacos',
              votes: 2,
              mine: true,
              voters: [{ name: 'Ben', userId: null }],
            },
          ],
          selectableCount: 1,
          voters: 2,
        },
      },
      {
        ...base,
        id: 'location',
        rich: {
          type: 'location',
          latitude: 40.7,
          longitude: -74,
          name: null,
          address: null,
          url: 'javascript:alert(document.cookie)',
          live: true,
          comment: null,
        },
      },
      {
        ...base,
        id: 'contacts',
        rich: {
          type: 'contacts',
          contacts: [{ name: 'Cy', phones: ['+1 555 0100'] }],
        },
      },
      {
        ...base,
        id: 'event',
        rich: {
          type: 'event',
          name: 'Launch',
          description: null,
          startAt: '2026-10-24T18:00:00Z',
          endAt: null,
          location: null,
          joinLink: 'https://meet.example/launch',
          canceled: false,
        },
      },
      {
        ...base,
        id: 'system',
        kind: 'system',
        rich: {
          type: 'system',
          action: 'call',
          actor: null,
          participants: [],
          value: null,
          call: { video: true, outcome: 'missed', durationSeconds: null },
        },
      },
    ],
  } satisfies ExternalChatMessages;
  client.messages.mockResolvedValue(ok(page));
  const { messages } = await externalChatApi.messages('chat-id', undefined);
  expect(messages.map((message) => [message.id, message.kind])).toEqual([
    ['mention', 'message'],
    ['sticker', 'message'],
    ['poll', 'message'],
    ['location', 'message'],
    ['contacts', 'message'],
    ['event', 'message'],
    ['system', 'system'],
  ]);
  expect(messages[0]).toMatchObject({
    forwarded: true,
    mentions: [
      { token: '15550001111', name: 'Ben', userId: 'macro|ben@x.test' },
      { token: '15550002222', name: '+1 555-000-2222', userId: undefined },
    ],
    rich: undefined,
  });
  expect(messages[1]?.attachments[0]).toMatchObject({
    width: 512,
    height: 512,
    durationSeconds: undefined,
    presentation: 'sticker',
  });
  expect(messages[2]?.rich).toEqual({
    type: 'poll',
    question: 'Lunch?',
    options: [
      { name: 'Tacos', votes: 2, mine: true, voters: [{ name: 'Ben' }] },
    ],
    selectableCount: 1,
    voters: 2,
  });
  expect(messages[3]?.rich).toEqual({
    type: 'location',
    latitude: 40.7,
    longitude: -74,
    live: true,
  });
  expect(messages[4]?.rich).toEqual({
    type: 'contacts',
    contacts: [{ name: 'Cy', phones: ['+1 555 0100'] }],
  });
  expect(messages[5]?.rich).toEqual({
    type: 'event',
    name: 'Launch',
    startAt: '2026-10-24T18:00:00Z',
    joinLink: 'https://meet.example/launch',
    canceled: false,
  });
  expect(messages[6]?.rich).toEqual({
    type: 'system',
    action: 'call',
    participants: [],
    call: { video: true, outcome: 'missed' },
  });
});

it('preserves the deliberate send key and maps quotes and reactions without a channel request', async () => {
  client.send.mockResolvedValue(ok({ id: 'send-1' }));
  await externalChatApi.send(
    'chat-id',
    { kind: 'text', text: 'Reply', replyTo: 'quoted-id' },
    'intent-key'
  );
  expect(client.send).toHaveBeenCalledWith('chat-id', {
    idempotencyKey: 'intent-key',
    message: { type: 'text', text: 'Reply', mentions: [] },
    replyTo: 'quoted-id',
  });
  await externalChatApi.send(
    'chat-id',
    {
      kind: 'text',
      text: 'Hi @15550001111',
      mentions: ['15550001111@s.whatsapp.net'],
    },
    'mention-key'
  );
  expect(client.send).toHaveBeenLastCalledWith('chat-id', {
    idempotencyKey: 'mention-key',
    message: {
      type: 'text',
      text: 'Hi @15550001111',
      mentions: ['15550001111@s.whatsapp.net'],
    },
    replyTo: null,
  });
  await externalChatApi.send(
    'chat-id',
    { kind: 'reaction', messageId: 'message-id', emoji: '' },
    'reaction-key'
  );
  expect(client.send).toHaveBeenLastCalledWith('chat-id', {
    idempotencyKey: 'reaction-key',
    message: {
      type: 'mutation',
      messageId: 'message-id',
      operation: 'reaction',
      text: '',
    },
    replyTo: null,
  });
});

it('tells refusals from unknown outcomes and keeps the reason DSS gave', async () => {
  client.send.mockResolvedValueOnce(
    err([
      {
        code: 'invalid_input',
        message: 'send an audio caption as a separate message',
      },
    ])
  );
  expect(
    (
      await externalChatApi.send(
        'chat-id',
        { kind: 'text', text: 'x' },
        'key-1'
      )
    )._unsafeUnwrapErr()
  ).toEqual({
    kind: 'refused',
    reason: 'Send an audio caption as a separate message.',
  });
  client.send.mockResolvedValueOnce(
    err([
      { code: 'disconnected', message: 'connect your WhatsApp account first' },
    ])
  );
  expect(
    (
      await externalChatApi.send(
        'chat-id',
        { kind: 'text', text: 'x' },
        'key-2'
      )
    )._unsafeUnwrapErr()
  ).toEqual({
    kind: 'refused',
    reason: 'Connect your WhatsApp in External to send.',
  });
  for (const code of [
    'NETWORK_ERROR',
    'temporarily_unavailable',
    'rate_limited',
  ] as const) {
    client.send.mockResolvedValueOnce(err([{ code, message: code }]));
    expect(
      (
        await externalChatApi.send(
          'chat-id',
          { kind: 'text', text: 'x' },
          'key-3'
        )
      )._unsafeUnwrapErr()
    ).toEqual({ kind: 'unknown' });
  }
});

it('reads recorded progress by send id', async () => {
  client.delivery.mockResolvedValue(
    ok([
      {
        id: 'send-1',
        chatId: 'chat-id',
        userId: 'macro|me@example.test',
        createdAt: '2026-10-21T12:00:00Z',
        state: 'accepted',
        messageId: 'message-9',
        payload: {
          idempotencyKey: 'key-1',
          message: { type: 'text', text: 'x' },
        },
      },
    ])
  );
  expect(await externalChatApi.delivery('chat-id', ['send-1'])).toEqual([
    {
      id: 'send-1',
      state: 'accepted',
      messageId: 'message-9',
      errorCode: undefined,
    },
  ]);
  expect(client.delivery).toHaveBeenCalledWith('chat-id', ['send-1']);
});
