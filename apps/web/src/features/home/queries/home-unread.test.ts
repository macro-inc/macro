import type { NotificationSource } from '@notifications/notification-source';
import type { HomeUnreadPresenceQuery } from '@service-storage/graphql/generated/graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeQueryCapabilities } from './home-query';
import { hasHomeUnreadWitness } from './home-unread';

const flags = vi.hoisted(() => ({ clientEmailSignal: false }));
vi.mock('@core/constant/featureFlags', () => ({
  get ENABLE_CLIENT_EMAIL_SIGNAL_FILTER() {
    return flags.clientEmailSignal;
  },
}));

type Item = HomeUnreadPresenceQuery['user']['soup']['items'][number];
type Email = Extract<Item, { __typename: 'GraphqlSoupEmailThread' }>;
const now = new Date('2026-10-13T12:00:00Z');
const capabilities: HomeQueryCapabilities = {
  calendar: true,
  foreignEntities: true,
  snippets: true,
  notifiedSort: false,
};
const base = {
  id: 'entity',
  metadata: {
    __typename: 'GraphqlEntityMetadata' as const,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  },
  unreadNotifications: [
    {
      __typename: 'GraphqlNotification' as const,
      id: 'witness',
      state: 'UNSEEN' as const,
    },
  ],
};
const channel: Item = { ...base, __typename: 'GraphqlSoupChannel' };
const email: Email = {
  ...base,
  __typename: 'GraphqlSoupEmailThread',
  isRead: false,
  inboxVisible: true,
  isDraft: false,
  sortTs: now.toISOString(),
  labels: [],
  unreadReminders: [],
};
const hasUnread = (
  items: Item[],
  source: Pick<NotificationSource, 'withLocalState'> = {},
  caps = capabilities
) => hasHomeUnreadWitness(items, caps, source, now);

beforeEach(() => {
  flags.clientEmailSignal = false;
});

describe('Home bounded unread witnesses', () => {
  it('uses state-only witnesses and preserves local seen/done overrides', () => {
    expect(hasUnread([channel])).toBe(true);
    expect(hasUnread([{ ...channel, unreadNotifications: [] }])).toBe(false);
    for (const state of ['seen', 'done'] as const) {
      expect(hasUnread([channel], { withLocalState: () => state })).toBe(false);
    }
    expect(hasUnread([channel], { withLocalState: () => 'unseen' })).toBe(true);
    expect(
      hasUnread([
        {
          ...channel,
          unreadNotifications: [
            { ...base.unreadNotifications[0], state: 'SEEN' },
          ],
        },
      ])
    ).toBe(false);
  });

  it('stops at the first unread entity, without loading full notification metadata', () => {
    const withLocalState = vi.fn(({ state }) => state);
    expect(
      hasUnread(
        Array.from({ length: 100 }, (_, i) => ({ ...channel, id: String(i) })),
        { withLocalState }
      )
    ).toBe(true);
    expect(withLocalState).toHaveBeenCalledExactlyOnceWith({
      id: 'witness',
      state: 'unseen',
    });
  });

  it('uses mailbox read/archive state independently from notification presence', () => {
    expect(hasUnread([{ ...email, unreadNotifications: [] }])).toBe(true);
    expect(hasUnread([{ ...email, isRead: true }])).toBe(false);
    expect(hasUnread([{ ...email, inboxVisible: false }])).toBe(false);
    expect(
      hasUnread([
        { ...email, isRead: true, unreadReminders: base.unreadNotifications },
      ])
    ).toBe(true);
    expect(
      hasUnread(
        [{ ...email, isRead: true, unreadReminders: base.unreadNotifications }],
        { withLocalState: () => 'done' }
      )
    ).toBe(false);
    expect(
      hasUnread([
        {
          ...email,
          inboxVisible: false,
          unreadReminders: base.unreadNotifications,
        },
      ])
    ).toBe(false);
  });

  it('preserves the optional client-side email Signal classification', () => {
    flags.clientEmailSignal = true;
    const noise: Email = {
      ...email,
      labels: [
        {
          id: 'label',
          name: 'CATEGORY_UPDATES',
          providerLabelId: 'CATEGORY_UPDATES',
        },
      ],
    };
    expect(hasUnread([noise])).toBe(false);
    expect(hasUnread([{ ...noise, isDraft: true }])).toBe(true);
    expect(hasUnread([email])).toBe(true);
  });

  it('keeps document/chat/folder/email recency and capability gates', () => {
    const oldMetadata = { ...base.metadata, updatedAt: '2026-08-01T00:00:00Z' };
    const document: Item = {
      ...base,
      __typename: 'GraphqlSoupDocument',
      subType: null,
    };
    const chat: Item = { ...base, __typename: 'GraphqlSoupChat' };
    const folder: Item = { ...base, __typename: 'GraphqlSoupProject' };
    for (const item of [document, chat, folder]) {
      expect(hasUnread([item])).toBe(true);
      expect(hasUnread([{ ...item, metadata: oldMetadata }])).toBe(false);
    }
    expect(hasUnread([{ ...email, sortTs: oldMetadata.updatedAt }])).toBe(
      false
    );
    expect(
      hasUnread(
        [{ ...document, subType: { __typename: 'GraphqlSnippetSubType' } }],
        {},
        { ...capabilities, snippets: false }
      )
    ).toBe(false);
    expect(
      hasUnread(
        [{ ...base, __typename: 'GraphqlSoupCalendarEvent' }],
        {},
        { ...capabilities, calendar: false }
      )
    ).toBe(false);
    expect(
      hasUnread(
        [{ ...base, __typename: 'GraphqlSoupForeignEntity' }],
        {},
        { ...capabilities, foreignEntities: false }
      )
    ).toBe(false);
  });

  it('accepts server-scoped thread witnesses, not arbitrary unsupported Soup types', () => {
    expect(
      hasUnread([{ ...base, __typename: 'GraphqlSoupChannelMessage' }])
    ).toBe(true);
    expect(hasUnread([{ ...base, __typename: 'GraphqlSoupCrmCompany' }])).toBe(
      false
    );
    expect(
      hasUnread([{ ...base, __typename: 'GraphqlSoupAgentSession' }])
    ).toBe(false);
  });
});
