import type {
  WhatsAppGroupDetail,
  WhatsAppGroupMessage,
  WhatsAppGroupMessages,
} from '@service-storage/generated/schemas';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { whatsappGroupApi } from './production-api';

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
vi.mock('@service-storage/whatsapp-groups', () => ({
  whatsappGroupsClient: client,
}));
beforeEach(() => vi.clearAllMocks());

it('decodes shared viewing separately from the callers own sending account and handles an absent roster', async () => {
  const detail = {
    id: '019a061e-0000-7000-8000-000000000001',
    kind: 'group',
    name: 'Shared group',
    user_id: 'macro|owner@example.test',
    unread_count: 3,
    last_message_at: null,
    can_send: false,
    send_reason: 'no_account',
    access_level: 'view',
    sending_identity: null,
    roster: null,
    share_permission: {
      id: 'share-1',
      owner: 'macro|owner@example.test',
      channelSharePermissions: [],
    },
    limits: {
      text_limit_bytes: 65536,
      attachment_limit_bytes: 33554432,
      max_attachments: 1,
      mutations: ['reaction', 'edit', 'delete'],
      mutation_window_seconds: 900,
      attachment_types: ['image/png', 'application/pdf'],
    },
  } satisfies WhatsAppGroupDetail;
  client.detail.mockResolvedValue(ok(detail));
  const group = await whatsappGroupApi.detail(detail.id);
  expect(group.ownerId).toBe('macro|owner@example.test');
  expect(group.accessLevel).toBe('view');
  expect(group.canSend).toBe(false);
  expect(group.phone).toBeUndefined();
  expect(group.members).toEqual([]);
  expect(group.limits.attachmentTypes).toEqual([
    'image/png',
    'application/pdf',
  ]);
});

it('decodes pagination, deleted flags, reaction ownership and attachment states from the independent timeline', async () => {
  const page = {
    next_cursor: '019a061e-0000-7000-8000-000000000002',
    messages: [
      {
        id: '019a061e-0000-7000-8000-000000000003',
        kind: 'message',
        sender: { person_id: 'person-1', user_id: null, name: 'Ana Ruiz' },
        body: '',
        mentions: [],
        forwarded: false,
        view_once: false,
        rich: null,
        reply_to: null,
        sent_at: '2026-10-21T12:00:00Z',
        received_at: '2026-10-21T12:00:01Z',
        edited_at: null,
        deleted: true,
        reactions: [{ emoji: '👍', count: 2, mine: true }],
        attachments: [
          {
            ordinal: 0,
            state: 'unsupported',
            file_name: 'drawing.psd',
            mime: 'image/vnd.adobe.photoshop',
            size: 1024,
            document_id: null,
          },
        ],
        delivery_state: null,
      },
    ],
  } satisfies WhatsAppGroupMessages;
  client.messages.mockResolvedValue(ok(page));
  const result = await whatsappGroupApi.messages('group-id', 'before-id');
  expect(client.messages).toHaveBeenCalledWith('group-id', 'before-id');
  expect(result.before).toBe(page.next_cursor);
  expect(result.messages[0]).toMatchObject({
    deleted: true,
    sender: { name: 'Ana Ruiz' },
    reactions: [{ emoji: '👍', count: 2, mine: true }],
    attachments: [
      { state: 'unsupported', fileName: 'drawing.psd', documentId: undefined },
    ],
  });
});

it('decodes mentions, forwarding, media presentation and every rich type', async () => {
  const base: Omit<WhatsAppGroupMessage, 'id'> = {
    sender: { person_id: 'person-1', user_id: null, name: 'Ana Ruiz' },
    body: '',
    reply_to: null,
    sent_at: '2026-10-21T12:00:00Z',
    received_at: '2026-10-21T12:00:01Z',
    edited_at: null,
    deleted: false,
    reactions: [],
    attachments: [],
    delivery_state: null,
    kind: 'message',
    mentions: [],
    forwarded: false,
    view_once: false,
    rich: null,
  };
  const page = {
    next_cursor: null,
    messages: [
      {
        ...base,
        id: 'mention',
        body: 'Hi @15550001111 and @15550002222',
        forwarded: true,
        mentions: [
          { token: '15550001111', name: 'Ben', user_id: 'macro|ben@x.test' },
          { token: '15550002222', name: '+1 555-000-2222', user_id: null },
        ],
      },
      {
        ...base,
        id: 'sticker',
        attachments: [
          {
            ordinal: 0,
            state: 'ready',
            file_name: 'sticker.webp',
            mime: 'image/webp',
            size: 2048,
            document_id: 'doc-1',
            width: 512,
            height: 512,
            duration_seconds: null,
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
              voters: [{ name: 'Ben', user_id: null }],
            },
          ],
          selectable_count: 1,
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
          url: null,
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
          start_at: '2026-10-24T18:00:00Z',
          end_at: null,
          location: null,
          join_link: null,
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
          call: { video: true, outcome: 'missed', duration_seconds: null },
        },
      },
    ],
  } satisfies WhatsAppGroupMessages;
  client.messages.mockResolvedValue(ok(page));
  const { messages } = await whatsappGroupApi.messages('group-id', undefined);
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
  await whatsappGroupApi.send(
    'group-id',
    { kind: 'text', text: 'Reply', replyTo: 'quoted-id' },
    'intent-key'
  );
  expect(client.send).toHaveBeenCalledWith('group-id', {
    idempotency_key: 'intent-key',
    message: { type: 'text', text: 'Reply', mentions: [] },
    reply_to: 'quoted-id',
  });
  await whatsappGroupApi.send(
    'group-id',
    {
      kind: 'text',
      text: 'Hi @15550001111',
      mentions: ['15550001111@s.whatsapp.net'],
    },
    'mention-key'
  );
  expect(client.send).toHaveBeenLastCalledWith('group-id', {
    idempotency_key: 'mention-key',
    message: {
      type: 'text',
      text: 'Hi @15550001111',
      mentions: ['15550001111@s.whatsapp.net'],
    },
    reply_to: null,
  });
  await whatsappGroupApi.send(
    'group-id',
    { kind: 'reaction', messageId: 'message-id', emoji: '' },
    'reaction-key'
  );
  expect(client.send).toHaveBeenLastCalledWith('group-id', {
    idempotency_key: 'reaction-key',
    message: {
      type: 'mutation',
      message_id: 'message-id',
      operation: 'reaction',
      text: '',
    },
    reply_to: null,
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
      await whatsappGroupApi.send(
        'group-id',
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
      await whatsappGroupApi.send(
        'group-id',
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
        await whatsappGroupApi.send(
          'group-id',
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
        group_id: 'group-id',
        user_id: 'macro|me@example.test',
        created_at: '2026-10-21T12:00:00Z',
        state: 'accepted',
        message_id: 'message-9',
        payload: {
          idempotency_key: 'key-1',
          message: { type: 'text', text: 'x' },
        },
      },
    ])
  );
  expect(await whatsappGroupApi.delivery('group-id', ['send-1'])).toEqual([
    {
      id: 'send-1',
      state: 'accepted',
      messageId: 'message-9',
      errorCode: undefined,
    },
  ]);
  expect(client.delivery).toHaveBeenCalledWith('group-id', ['send-1']);
});
