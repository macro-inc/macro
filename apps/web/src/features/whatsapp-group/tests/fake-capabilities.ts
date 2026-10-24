import { createSignal } from 'solid-js';
import { vi } from 'vitest';
import type { SourceRead } from '../../whatsapp-linked/context/whatsapp-linked-context';
import type { WhatsAppGroupCapabilities } from '../context/whatsapp-group-context';
import type {
  GroupDetail,
  GroupMessage,
  GroupSend,
  PendingSend,
} from '../core/group';

export const group: GroupDetail = {
  id: '019a061e-0000-7000-8000-000000000001',
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
export const messages: GroupMessage[] = [
  {
    id: 'message-1',
    sender: { name: 'Ana Ruiz' },
    body: 'The updated designs are ready for review.',
    sentAt: '2026-10-21T10:00:00Z',
    edited: false,
    deleted: false,
    reactions: [{ emoji: '👍', count: 2, mine: true }],
    attachments: [],
  },
  {
    id: 'message-2',
    sender: { name: 'Me', userId: 'macro|me@example.test' },
    body: 'Looking now. Thanks, Ana!',
    sentAt: new Date().toISOString(),
    edited: false,
    deleted: false,
    replyTo: 'message-1',
    reactions: [],
    attachments: [],
    delivery: 'delivered',
  },
];
export function createFakeGroup(
  initial: {
    group?: GroupDetail;
    messages?: GroupMessage[];
    sends?: PendingSend[];
  } = {}
) {
  const [detail, setGroup] = createSignal(initial.group ?? group);
  const [timeline, setMessages] = createSignal(initial.messages ?? messages);
  const read = <T>(data: () => T): SourceRead<T> => ({
    get data() {
      return data();
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  const capabilities = {
    group: read(detail),
    timeline: read(timeline),
    sends: read(() => initial.sends ?? []),
    hasOlder: () => false,
    loadingOlder: () => false,
    loadOlder: vi.fn(async () => undefined),
    send: vi.fn(
      async (_request: GroupSend, _idempotencyKey: string) => undefined
    ),
    upload: vi.fn(async (_file: File) => ({
      uploadId: 'upload-1',
      audio: false,
    })),
    markRead: vi.fn(async (_messageId: string) => undefined),
    stopSync: vi.fn(async () => undefined),
  } satisfies WhatsAppGroupCapabilities;
  return { capabilities, setGroup, setMessages };
}
