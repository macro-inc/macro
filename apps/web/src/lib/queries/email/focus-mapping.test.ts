import type { EmailFocusQuery } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, vi } from 'vitest';
import { mapEmailFocus } from './focus';

// Exercise the pure mapping without UI barrels or live connections. Separate
// from focus.test.ts, which mocks this mapping away to test the query binding.
vi.mock('@graphql-cache/solid/create-live-query', () => ({
  createLiveQuery: vi.fn(),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: {},
  itemToSafeName: vi.fn(),
}));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));
vi.mock('@core/user', () => ({ emailToId: vi.fn() }));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

type FocusThread = EmailFocusQuery['user']['emailFocus'][number];

const thread = (timestamps: Partial<FocusThread>) =>
  ({
    __typename: 'GraphqlSoupEmailThread',
    id: 'thread',
    entityType: 'EMAIL_THREAD',
    frecencyScore: 0,
    isFavorited: false,
    providerId: null,
    ownerId: 'owner',
    inboxVisible: true,
    hasReceivedMail: true,
    emailName: 'Subject',
    snippet: 'The latest message',
    senderEmail: 'sender@example.com',
    senderName: 'Sender',
    senderPhotoUrl: null,
    isRead: false,
    isDraft: false,
    isImportant: false,
    isSignal: true,
    projectId: null,
    sortTs: '2026-10-05T10:00:00+00:00',
    createdAt: '2026-10-01T00:00:00+00:00',
    updatedAt: '2026-10-09T00:00:00+00:00',
    viewedAt: null,
    latestInboundMessageTs: null,
    latestOutboundMessageTs: null,
    latestNonSpamMessageTs: null,
    reminderReturnedAt: null,
    participants: [],
    attachments: [],
    labels: [],
    properties: [],
    notifications: [],
    focus: {
      category: 'TEAM',
      importance: 70,
      needsReply: false,
      needsFollowUp: true,
    },
    ...timestamps,
  }) as unknown as FocusThread;

const mapped = (timestamps: Partial<FocusThread>) =>
  mapEmailFocus({
    user: { id: 'owner', emailFocus: [thread(timestamps)] },
  } as EmailFocusQuery)[0];

describe('mapEmailFocus', () => {
  it('carries the classification onto the row', () => {
    expect(mapped({})?.focus).toEqual({
      category: 'TEAM',
      importance: 70,
      needsReply: false,
      needsFollowUp: true,
    });
  });

  it('dates a thread the owner replied to last by that reply', () => {
    const row = mapped({
      latestInboundMessageTs: '2026-10-05T10:00:00+00:00',
      latestOutboundMessageTs: '2026-10-08T10:00:00+00:00',
      latestNonSpamMessageTs: '2026-10-08T10:00:00+00:00',
    });
    expect(row?.sortTs).toBe('2026-10-08T10:00:00+00:00');
  });

  it('dates a thread someone else wrote to last by that message', () => {
    const row = mapped({
      latestInboundMessageTs: '2026-10-08T10:00:00+00:00',
      latestOutboundMessageTs: '2026-10-05T10:00:00+00:00',
      latestNonSpamMessageTs: '2026-10-08T10:00:00+00:00',
    });
    expect(row?.sortTs).toBe('2026-10-08T10:00:00+00:00');
  });

  it('does not date a thread by a reminder returning it', () => {
    const row = mapped({
      latestInboundMessageTs: '2026-10-05T10:00:00+00:00',
      latestNonSpamMessageTs: '2026-10-05T10:00:00+00:00',
      reminderReturnedAt: '2026-10-08T10:00:00+00:00',
    });
    expect(row?.sortTs).toBe('2026-10-05T10:00:00+00:00');
  });
});
