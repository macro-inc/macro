import {
  createTagFacetContext,
  EMPTY_TAG_FACET_CONTEXT,
} from '@app/features/soup';
import type { EntityData, WithNotification } from '@entity';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { describe, expect, it, vi } from 'vitest';
import type { EmailTab } from '../types';
import {
  buildEmailQuery,
  type EmailQueryContext,
  emailViewForTab,
} from './email-query';
import { groupEmailEntitiesByDate } from './email-results';
import { buildEmailSearchRequest } from './email-search';

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
  ...(await import('@entity/utils/task-properties')),
  ...(await import('@entity/utils/company-properties')),
}));
vi.mock('@notifications', async () => await import('@notifications/types'));

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
  'favorites',
  'sent',
  'scheduled',
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
  facetContext: EMPTY_TAG_FACET_CONTEXT,
  ...overrides,
});

const TAG_SETS = [
  {
    scope: 'user',
    definition: { id: 'tag-definition' },
    options: [
      {
        id: 'invoices',
        propertyDefinitionId: 'tag-definition',
        displayOrder: 0,
        value: { type: 'string', value: 'Invoices' },
      },
    ],
  },
] as TagSetResponse[];

describe('buildEmailQuery', () => {
  it('filters favorites on the server in both Soup transports, including inbox and read scope', () => {
    const args = buildEmailQuery(
      contextFor({
        tab: 'favorites',
        favoriteThreadIds: ['starred-a', 'starred-b'],
        inboxIds: ['inbox-a'],
        facets: { read: ['unread'] },
      })
    );
    expect(args.transport).toBeUndefined();
    expect(args.body.emailView).toBe('all');
    expect(serialize(args.body.ef)).toContain(
      serialize({ l: { ThreadId: 'starred-a' } })
    );
    const input = makeGraphqlSoupInput(args);
    expect(input.initial?.emailView).toBe('ALL');
    const filter = serialize(input.initial?.filters?.emailFilter);
    expect(filter).toContain(serialize({ literal: { threadId: 'starred-a' } }));
    expect(filter).toContain(serialize({ literal: { threadId: 'starred-b' } }));
    expect(filter).toContain(serialize({ literal: { owner: 'inbox-a' } }));
    expect(filter).toContain(serialize({ literal: { read: false } }));
    expect(filter).not.toContain('inboxVisible');
  });

  it('matches no email when favorites are empty or unresolved', () => {
    for (const favoriteThreadIds of [undefined, []]) {
      const args = buildEmailQuery(
        contextFor({ tab: 'favorites', favoriteThreadIds })
      );
      expect(args.body.ef).toEqual({ l: { ThreadId: NIL } });
      expect(makeGraphqlSoupInput(args).initial?.filters?.emailFilter).toEqual({
        tree: { literal: { threadId: NIL } },
      });
    }
  });

  it('keeps a full admission batch below REST and GraphQL ingress recursion limits', () => {
    const ids = Array.from(
      { length: 100 },
      (_, index) =>
        `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`
    );
    const args = buildEmailQuery(
      contextFor({ tab: 'important', facets: { read: ['unread'] } }),
      ids
    );
    const graphql = makeGraphqlSoupInput({ ...args, cursor: null });
    const depth = (value: unknown): number =>
      value && typeof value === 'object'
        ? 1 + Math.max(0, ...Object.values(value).map(depth))
        : 0;
    expect(depth(args.body)).toBeLessThan(40);
    expect(depth(graphql)).toBeLessThan(40);
    for (const id of ids) expect(serialize(graphql)).toContain(id);
    expect(serialize(args.body.ef)).not.toContain('"Read"');
  });

  it('lists the server view each tab reads from', () => {
    expect(TABS.map((tab) => [tab, emailViewForTab(tab)])).toEqual([
      ['important', 'inbox'],
      ['noise', 'inbox'],
      ['favorites', 'all'],
      ['sent', 'sent'],
      ['scheduled', 'drafts'],
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
      serialize({ l: { Read: false } })
    );
    expect(ef({ read: ['read'] })).toContain(serialize({ l: { Read: true } }));
    expect(ef({ done: ['done'] })).toContain(
      serialize({ l: { InboxVisible: false } })
    );
    expect(ef({ done: ['not-done'] })).toContain(
      serialize({ l: { InboxVisible: true } })
    );
    expect(ef({ done: ['done'] })).not.toContain('NotificationState');
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

  it('refines by selected tags as a property filter', () => {
    const facetContext = createTagFacetContext(TAG_SETS);
    const { propf } = buildEmailQuery(
      contextFor({ facets: { tags: ['invoices'] }, facetContext })
    ).body;

    expect(propf).toEqual({
      l: { pd: 'tag-definition', v: { so: 'invoices' } },
    });
  });

  it('keeps an unresolved tag selection from filtering', () => {
    const plain = buildEmailQuery(contextFor()).body;
    const withUnknownTag = buildEmailQuery(
      contextFor({ facets: { tags: ['deleted-tag'] } })
    ).body;

    expect(withUnknownTag).toEqual(plain);
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

  it('restricts search and retained results to current favorites before pagination', () => {
    const context = contextFor({
      tab: 'favorites',
      favoriteThreadIds: ['starred-a', 'starred-b'],
      inboxIds: ['inbox-a'],
    });
    expect(
      buildEmailSearchRequest(context, search).body.filters?.email_filters
    ).toEqual({
      email_thread_ids: ['starred-a', 'starred-b'],
      link_ids: ['inbox-a'],
    });
    expect(
      buildEmailSearchRequest(context, search, ['starred-b', 'removed']).body
        .filters?.email_filters?.email_thread_ids
    ).toEqual(['starred-b']);
    expect(
      requestFor({ tab: 'favorites', favoriteThreadIds: [] }).filters
        .email_filters?.email_thread_ids
    ).toEqual([NIL]);
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
    expect(filtersFor('all')).toEqual({});
  });

  it('leaves Drafts and Sent search unscoped', () => {
    const filtersFor = (tab: EmailTab) =>
      requestFor({ tab }).filters.email_filters;

    // Macro-composed drafts are unindexed and unlabeled; the client trims
    // both tabs' results instead (see tabFilters).
    expect(filtersFor('drafts')).toEqual({});
    expect(filtersFor('sent')).toEqual({});
  });

  it('restricts to the selected inboxes', () => {
    const selected = requestFor({ inboxIds: ['link-a'] }).filters.email_filters;
    const none = requestFor({ inboxIds: [] }).filters.email_filters;

    expect(selected).toEqual({ link_ids: ['link-a'] });
    expect(none).toEqual({ link_ids: [NIL] });
  });

  it('maps email read independently of notification state selections', () => {
    const filters = requestFor({
      facets: { read: ['unread'], done: ['not-done'] },
    }).filters.email_filters;

    expect(filters).toEqual({
      is_read: false,
      notification_filters: { states: ['unseen', 'seen'] },
    });
    expect(
      requestFor({ facets: { read: ['read'] } }).filters.email_filters
    ).toEqual({ is_read: true });
    expect(
      requestFor({ facets: { read: ['read'], done: ['done'] } }).filters
        .email_filters
    ).toEqual({
      is_read: true,
      notification_filters: { states: ['done'] },
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

  it('sends selected tags as an entity-wide filter', () => {
    const { filters } = requestFor({
      facets: { tags: ['invoices', 'invoices'] },
      facetContext: createTagFacetContext(TAG_SETS),
    });

    expect(filters.tag_option_ids).toEqual(['invoices']);
    expect(filters.tag_filter_mode).toBe('any');
    expect(filters.email_filters).toEqual({});
  });

  it('drops a selected tag that no longer exists, like the list query', () => {
    const { filters } = requestFor({
      facets: { tags: ['invoices', 'deleted-tag'] },
      facetContext: createTagFacetContext(TAG_SETS),
    });

    expect(filters.tag_option_ids).toEqual(['invoices']);

    const unresolved = requestFor({ facets: { tags: ['deleted-tag'] } });
    expect(unresolved.filters.tag_option_ids).toBeUndefined();
    expect(unresolved.filters.tag_filter_mode).toBeUndefined();
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
