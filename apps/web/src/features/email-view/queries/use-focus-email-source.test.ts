import { createTagFacetContext } from '@app/features/soup';
import type { EmailEntity, EmailFocus } from '@entity';
import { describe, expect, it, vi } from 'vitest';
import type { EmailDataSourceInput } from './use-email-query';
import { buildFocusRows, selectFocusEmails } from './use-focus-email-source';

// Exercise the pure selection without UI barrels or live connections.
vi.mock('@queries/email/focus', () => ({ useEmailFocusQuery: vi.fn() }));
vi.mock('@queries/soup/graphql/done-projection', () => ({
  createGraphqlSoupDoneProjection: vi.fn(),
}));
vi.mock('@queries/soup/graphql/optimistic-done', () => ({
  usePendingGraphqlSoupDone: vi.fn(),
}));
vi.mock('../tab-availability', () => ({ useEmailTabAvailability: vi.fn() }));
vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
}));
vi.mock('@app/features/soup/collection', async () => ({
  ...(await import('@app/features/soup/collection/date-buckets')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/collection/transforms')),
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: vi.fn(),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: vi.fn(),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
}));
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

function email(
  id: string,
  focus: Partial<EmailFocus>,
  overrides: Partial<EmailEntity> = {}
): EmailEntity {
  return {
    type: 'email',
    id,
    name: `Subject ${id}`,
    ownerId: 'alice',
    linkId: 'inbox-a',
    isRead: false,
    isDraft: false,
    isImportant: false,
    done: false,
    focus: {
      importance: 50,
      needsReply: false,
      needsFollowUp: false,
      ...focus,
    },
    ...overrides,
  };
}

// Listed out of date order, so a test can tell a sort from the server's order.
const EMAILS = [
  email(
    'report',
    { importance: 93 },
    {
      sortTs: '2026-10-05T10:00:00Z',
      linkId: 'inbox-b',
    }
  ),
  email(
    'invoice',
    { importance: 70, needsReply: true },
    {
      sortTs: '2026-10-08T10:00:00Z',
      senderName: 'Casey',
    }
  ),
  email(
    'plan',
    { importance: 61, needsFollowUp: true },
    {
      sortTs: '2026-10-06T10:00:00Z',
      snippet: 'CRM rollout plan',
    }
  ),
];

const context = createTagFacetContext([]);

function select(
  input: Partial<EmailDataSourceInput>,
  emails: readonly EmailEntity[] = EMAILS
): string[] {
  return selectFocusEmails(
    emails,
    {
      tab: 'focus',
      search: '',
      inboxIds: undefined,
      facets: {},
      focusSort: 'recent',
      ...input,
    },
    context
  ).map((selected) => selected.id);
}

describe('selectFocusEmails', () => {
  it('orders by importance on request', () => {
    expect(select({ focusSort: 'importance' })).toEqual([
      'report',
      'invoice',
      'plan',
    ]);
  });

  it('breaks importance ties by recency', () => {
    const [report, invoice, plan] = EMAILS;
    const tied = [
      report,
      invoice,
      { ...plan, focus: { ...plan.focus!, importance: 93 } },
    ];
    expect(select({ focusSort: 'importance' }, tied)).toEqual([
      'plan',
      'report',
      'invoice',
    ]);
  });

  it('orders newest first, whatever order the server sent', () => {
    expect(select({ focusSort: 'recent' })).toEqual([
      'invoice',
      'plan',
      'report',
    ]);
  });

  it('filters by Focus flags', () => {
    expect(select({ facets: { focus: ['focus-reply-needed'] } })).toEqual([
      'invoice',
    ]);
    expect(select({ facets: { focus: ['focus-follow-up'] } })).toEqual([
      'plan',
    ]);
  });

  it('scopes to the selected inboxes', () => {
    expect(select({ inboxIds: ['inbox-b'] })).toEqual(['report']);
    expect(select({ inboxIds: [] })).toEqual([]);
  });

  it('searches subject, snippet and sender', () => {
    expect(select({ search: 'casey' })).toEqual(['invoice']);
    expect(select({ search: 'rollout' })).toEqual(['plan']);
    expect(select({ search: 'subject report' })).toEqual(['report']);
  });

  it('does not reorder the input list', () => {
    select({ focusSort: 'importance' });
    select({ focusSort: 'recent' });
    expect(EMAILS.map((selected) => selected.id)).toEqual([
      'report',
      'invoice',
      'plan',
    ]);
  });

  it('ignores Status and Done filters, which Focus does not offer', () => {
    const [report, ...rest] = EMAILS;
    expect(
      select({ facets: { read: ['read'], done: ['done'] } }, [
        { ...report, isRead: true },
        ...rest,
      ])
    ).toEqual(['invoice', 'plan', 'report']);
  });

  it('drops threads marked done', () => {
    const [report, ...rest] = EMAILS;
    expect(select({}, [{ ...report, done: true }, ...rest])).toEqual([
      'invoice',
      'plan',
    ]);
  });
});

describe('buildFocusRows', () => {
  // Thursday, October 15 2026, local time.
  const NOW = new Date(2026, 9, 15, 12);
  const SENT_AT: [string, Date][] = [
    ['this-morning', new Date(2026, 9, 15, 8)],
    ['just-after-midnight', new Date(2026, 9, 15, 0, 5)],
    ['last-night', new Date(2026, 9, 14, 23, 55)],
    ['tuesday', new Date(2026, 9, 13, 9)],
    ['friday', new Date(2026, 9, 9, 9)],
    ['a-week-ago', new Date(2026, 9, 8, 9)],
    ['last-year', new Date(2025, 11, 30, 9)],
  ];
  const EMAILS_BY_DATE = SENT_AT.map(([id, sortTs]) =>
    email(id, {}, { sortTs: sortTs.toISOString() })
  );
  const shape = (rows: ReturnType<typeof buildFocusRows>) =>
    rows.map((row) => {
      if (row.kind === 'group-header') return `# ${row.label}`;
      return row.kind === 'entity' ? row.entity.id : row.kind;
    });

  it('heads a most recent list with Today, Yesterday, weekdays, then dates', () => {
    expect(shape(buildFocusRows(EMAILS_BY_DATE, 'recent', NOW))).toEqual([
      '# Today',
      'this-morning',
      'just-after-midnight',
      '# Yesterday',
      'last-night',
      '# Tuesday',
      'tuesday',
      '# Friday',
      'friday',
      '# Oct 8',
      'a-week-ago',
      '# Dec 30, 2025',
      'last-year',
    ]);
  });

  it('heads a thread dated in the future with Today, not a second day', () => {
    const skewed = email(
      'skewed',
      {},
      { sortTs: new Date(2026, 9, 16, 9).toISOString() }
    );
    expect(
      shape(
        buildFocusRows([skewed, ...EMAILS_BY_DATE.slice(0, 1)], 'recent', NOW)
      )
    ).toEqual(['# Today', 'skewed', 'this-morning']);
  });

  it('keeps importance flat, with no day headers', () => {
    expect(shape(buildFocusRows(EMAILS_BY_DATE, 'importance', NOW))).toEqual(
      SENT_AT.map(([id]) => id)
    );
  });

  it('gives a thread the same row id in both orders, so list focus survives a sort change', () => {
    const entityRowIds = (sort: 'recent' | 'importance') =>
      buildFocusRows(EMAILS_BY_DATE, sort, NOW)
        .filter((row) => row.kind === 'entity')
        .map((row) => row.id);
    expect(entityRowIds('recent')).toEqual(entityRowIds('importance'));
  });
});
