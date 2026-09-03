import type { EntityData, WithNotification } from '@entity';
import { describe, expect, it, vi } from 'vitest';
import type { EmailTab } from '../types';
import {
  buildEmailQuery,
  type EmailQueryContext,
  emailViewForTab,
} from './email-query';
import { groupEmailEntitiesByDate } from './email-results';
import { buildEmailSearchRequest } from './email-search';

// The soup barrel these pull in transitively imports the websocket client
// modules, which open real sockets at module scope and reject under jsdom.
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

const NIL = '00000000-0000-0000-0000-000000000000';
const TABS: EmailTab[] = [
  'important',
  'noise',
  'sent',
  'calendar',
  'drafts',
  'shared',
  'all',
];

const serialize = (value: unknown) => JSON.stringify(value);

const contextFor = (
  overrides: Partial<EmailQueryContext> = {}
): EmailQueryContext => ({
  tab: 'all',
  inboxIds: undefined,
  facets: {},
  ...overrides,
});

describe('buildEmailQuery', () => {
  it('lists the server view each tab reads from', () => {
    expect(TABS.map((tab) => [tab, emailViewForTab(tab)])).toEqual([
      ['important', 'inbox'],
      ['noise', 'inbox'],
      ['sent', 'sent'],
      ['calendar', 'all'],
      ['drafts', 'drafts'],
      ['shared', 'all'],
      ['all', 'all'],
    ]);

    for (const tab of TABS) {
      expect(buildEmailQuery(contextFor({ tab })).body.emailView).toBe(
        emailViewForTab(tab)
      );
    }
  });

  it('confines every non-email target to nothing', () => {
    const { body } = buildEmailQuery(contextFor());

    expect(body.df).toEqual({ l: { id: NIL } });
    expect(body.chanf).toEqual({ l: { ChannelId: NIL } });
    expect(body.cthf).toEqual({ l: { ChannelId: NIL } });
    expect(body.cf).toEqual({ l: { cid: NIL } });
    expect(body.pf).toEqual({ l: { pid: NIL } });
    expect(body.calf).toEqual({ l: { id: NIL } });
    expect(body.callf).toEqual({ l: { CallId: NIL } });
    expect(body.fef).toEqual({ l: { id: NIL } });
    expect(body.ccf).toEqual({ l: { id: NIL } });
    expect(body.remf).toEqual({ l: { id: NIL } });
    expect(body.ef).toEqual({ '!': { l: { ThreadId: NIL } } });
  });

  it('scopes Signal and Noise by importance and excludes shared threads', () => {
    const signal = serialize(
      buildEmailQuery(contextFor({ tab: 'important' })).body.ef
    );
    const noise = serialize(
      buildEmailQuery(contextFor({ tab: 'noise' })).body.ef
    );

    expect(signal).toContain(serialize({ l: { Importance: true } }));
    expect(signal).toContain(serialize({ l: { Shared: 'exclude' } }));
    expect(noise).toContain(serialize({ l: { Importance: false } }));
    expect(noise).toContain(serialize({ l: { Shared: 'exclude' } }));
  });

  it('scopes Calendar to invite threads and Shared to shared threads', () => {
    const calendar = serialize(
      buildEmailQuery(contextFor({ tab: 'calendar' })).body.ef
    );
    const shared = buildEmailQuery(contextFor({ tab: 'shared' })).body.ef;

    expect(calendar).toContain(serialize({ l: { CalendarOnly: true } }));
    expect(calendar).toContain(serialize({ l: { Shared: 'exclude' } }));
    expect(shared).toEqual({ l: { Shared: 'only' } });
  });

  it('leaves the inbox unscoped when every inbox is selected', () => {
    const { body } = buildEmailQuery(contextFor());

    expect(serialize(body.ef)).not.toContain('Owner');
  });

  it('ORs the selected inbox owners', () => {
    const { body } = buildEmailQuery(
      contextFor({ inboxIds: ['link-a', 'link-b'] })
    );

    expect(body.ef).toEqual({
      '&': [
        { '!': { l: { ThreadId: NIL } } },
        { '|': [{ l: { Owner: 'link-a' } }, { l: { Owner: 'link-b' } }] },
      ],
    });
  });

  it('matches nothing when no inbox is selected', () => {
    const { body } = buildEmailQuery(contextFor({ inboxIds: [] }));

    expect(serialize(body.ef)).toContain(serialize({ l: { Owner: NIL } }));
  });

  it('refines by the read, done, and calendar facets on the server', () => {
    const ef = (facets: EmailQueryContext['facets']) =>
      serialize(buildEmailQuery(contextFor({ facets })).body.ef);

    expect(ef({ read: ['unread'] })).toContain(
      serialize({ l: { NotificationSeen: false } })
    );
    expect(ef({ read: ['read'] })).toContain(
      serialize({ l: { NotificationSeen: true } })
    );
    expect(ef({ done: ['done'] })).toContain(
      serialize({ l: { NotificationDone: true } })
    );
    expect(ef({ calendar: ['has-calendar-invite'] })).toContain(
      serialize({ l: { CalendarOnly: true } })
    );
  });

  it('leaves attachment facets to the client', () => {
    const plain = buildEmailQuery(contextFor()).body;
    const withAttachments = buildEmailQuery(
      contextFor({ facets: { attachments: ['attachment-pdf'] } })
    ).body;

    expect(withAttachments).toEqual(plain);
  });

  it('pages by latest thread activity, newest first', () => {
    expect(buildEmailQuery(contextFor()).params).toEqual({
      expand: true,
      limit: 100,
      sort_method: 'updated_at',
      sort_direction: 'desc',
    });
  });
});

describe('buildEmailSearchRequest', () => {
  const search = { query: 'invoice', matchType: 'partial' as const };

  const requestFor = (overrides: Partial<EmailQueryContext> = {}) => {
    const { body } = buildEmailSearchRequest(contextFor(overrides), search);
    if (!body.filters) throw new Error('search request has no filters');

    return { ...body, filters: body.filters };
  };

  it('searches only email threads', () => {
    const body = requestFor();

    expect(body.query).toBe('invoice');
    expect(body.search_on).toBe('name_content');
    expect(body.filters.document_filters).toEqual({ document_ids: [NIL] });
    expect(body.filters.channel_filters).toEqual({ channel_ids: [NIL] });
    expect(body.filters.email_filters).toEqual({});
  });

  it('mirrors the tab scoping the list applies', () => {
    const filtersFor = (tab: EmailTab) =>
      requestFor({ tab }).filters.email_filters;

    expect(filtersFor('important')).toEqual({
      importance: true,
      shared: 'exclude',
    });
    expect(filtersFor('noise')).toEqual({
      importance: false,
      shared: 'exclude',
    });
    expect(filtersFor('calendar')).toEqual({
      calendar_only: true,
      shared: 'exclude',
    });
    expect(filtersFor('shared')).toEqual({ shared: 'only' });
    expect(filtersFor('drafts')).toEqual({});
    expect(filtersFor('sent')).toEqual({});
  });

  it('restricts to the selected inboxes', () => {
    const selected = requestFor({ inboxIds: ['link-a'] }).filters.email_filters;
    const none = requestFor({ inboxIds: [] }).filters.email_filters;

    expect(selected).toEqual({ link_ids: ['link-a'] });
    expect(none).toEqual({ link_ids: [NIL] });
  });

  it('maps the read and done facets to notification filters', () => {
    const filters = requestFor({
      facets: { read: ['unread'], done: ['not-done'] },
    }).filters.email_filters;

    expect(filters).toEqual({
      notification_filters: { seen: false, done: false },
    });
  });

  it('maps the calendar facet and ignores attachment facets', () => {
    const filters = requestFor({
      facets: {
        calendar: ['has-calendar-invite'],
        attachments: ['attachment-pdf'],
      },
    }).filters.email_filters;

    expect(filters).toEqual({ calendar_only: true });
  });
});

describe('groupEmailEntitiesByDate', () => {
  const now = new Date('2026-09-03T18:00:00Z');

  const email = (
    id: string,
    stamps: Partial<Pick<EntityData, 'sortTs' | 'updatedAt' | 'createdAt'>>
  ) =>
    ({
      id,
      type: 'email',
      name: id,
      ownerId: 'macro|alice@example.com',
      ...stamps,
    }) as unknown as WithNotification<EntityData>;

  it('buckets on the server sort stamp, then thread recency', () => {
    const groups = groupEmailEntitiesByDate(
      [
        // Served by the page: the sort stamp wins over the stale updatedAt.
        email('paged', {
          sortTs: '2026-09-03T17:00:00Z',
          updatedAt: '2026-08-20T09:00:00Z',
        }),
        // A websocket insert without a stamp falls back to updatedAt.
        email('inserted', { updatedAt: '2026-09-03T16:00:00Z' }),
        // Nothing but a creation time still lands in a bucket.
        email('bare', { createdAt: '2026-08-20T09:00:00Z' }),
      ],
      now
    );

    expect(groups.map((group) => group.entities.map((e) => e.id))).toEqual([
      ['paged', 'inserted'],
      ['bare'],
    ]);
  });
});
