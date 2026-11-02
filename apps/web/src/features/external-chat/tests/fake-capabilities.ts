import { ok, type Result } from 'neverthrow';
import { createSignal } from 'solid-js';
import { vi } from 'vitest';
import type { SourceRead } from '../../whatsapp-linked/context/whatsapp-linked-context';
import type { ExternalChatCapabilities } from '../context/external-chat-context';
import type {
  ChatDetail,
  ChatMessage,
  ChatSend,
  SendFailure,
  SendProgress,
} from '../core/chat';

export const chat: ChatDetail = {
  id: '019a061e-0000-7000-8000-000000000001',
  provider: 'whatsapp',
  kind: 'group',
  name: 'Design Crit',
  ownerId: 'macro|me@example.test',
  accessLevel: 'owner',
  canSend: true,
  phone: '+14155550142',
  unreadCount: 1,
  lastReadMessageId: 'message-1',
  members: [{ id: 'ana', name: 'Ana Ruiz', admin: true }],
  limits: {
    textBytes: 65536,
    attachmentBytes: 33554432,
    attachmentTypes: ['image/png', 'application/pdf', 'audio/ogg'],
    editSeconds: 900,
    mutations: ['reaction', 'edit', 'delete'],
  },
};
export const messages: ChatMessage[] = [
  {
    id: 'message-1',
    kind: 'message',
    sender: { name: 'Ana Ruiz' },
    mentions: [],
    forwarded: false,
    body: 'The *updated* designs are ready for review.',
    sentAt: '2026-10-21T10:00:00Z',
    edited: false,
    deleted: false,
    reactions: [{ emoji: '👍', count: 2, mine: true }],
    attachments: [],
  },
  {
    id: 'message-2',
    kind: 'message',
    sender: { name: 'Me', userId: 'macro|me@example.test' },
    mentions: [],
    forwarded: false,
    body: 'Looking now. Thanks, Ana!',
    sentAt: new Date().toISOString(),
    edited: false,
    deleted: false,
    replyTo: 'message-1',
    reactions: [],
    attachments: [],
  },
];
export function createFakeChat(
  initial: { chat?: ChatDetail; messages?: ChatMessage[] } = {}
) {
  const [detail, setChat] = createSignal(initial.chat ?? chat);
  const [timeline, setMessages] = createSignal(initial.messages ?? messages);
  const [delivery, setDelivery] = createSignal<SendProgress[]>([]);
  const read = <T>(data: () => T): SourceRead<T> => ({
    get data() {
      return data();
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  const capabilities = {
    chat: read(detail),
    timeline: read(timeline),
    hasOlder: () => false,
    loadingOlder: () => false,
    loadOlder: vi.fn(async () => true),
    send: vi.fn(
      async (
        _request: ChatSend,
        idempotencyKey: string
      ): Promise<Result<SendProgress, SendFailure>> =>
        ok({ id: `send-${idempotencyKey}`, state: 'pending' })
    ),
    delivery: () => read(delivery),
    upload: vi.fn(
      async (
        _file: File
      ): Promise<Result<{ uploadId: string; audio: boolean }, SendFailure>> =>
        ok({ uploadId: 'upload-1', audio: false })
    ),
    fileUrl: (fileId: string) => `https://files.example.test/${fileId}`,
    markRead: vi.fn(async (_messageId: string) => undefined),
    stopSync: vi.fn(async () => undefined),
    importHistory: vi.fn(async () => undefined),
  } satisfies ExternalChatCapabilities;
  return { capabilities, setChat, setMessages, setDelivery };
}
