import type {
  WhatsAppGroupDetail,
  WhatsAppGroupMessages,
} from '@service-storage/generated/schemas';
import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { whatsappGroupApi } from './production-api';

const client = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  messages: vi.fn(),
  sends: vi.fn(),
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
        sender: { person_id: 'person-1', user_id: null, name: 'Ana Ruiz' },
        body: '',
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

it('preserves the deliberate send key and maps quotes and reactions without a channel request', async () => {
  client.send.mockResolvedValue(ok({ id: 'send-1' }));
  await whatsappGroupApi.send(
    'group-id',
    { kind: 'text', text: 'Reply', replyTo: 'quoted-id' },
    'intent-key'
  );
  expect(client.send).toHaveBeenCalledWith('group-id', {
    idempotency_key: 'intent-key',
    message: { type: 'text', text: 'Reply' },
    reply_to: 'quoted-id',
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
