import { createTagFacetContext } from '@app/features/soup';
import type { EmailEntity, EmailFocus } from '@entity';
import { describe, expect, it, vi } from 'vitest';
import type { EmailDataSourceInput } from './use-email-query';
import { selectFocusEmails } from './use-focus-email-source';

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
      category: 'OTHER',
      importance: 50,
      needsReply: false,
      needsFollowUp: false,
      ...focus,
    },
    ...overrides,
  };
}

// Server order: most important first.
const EMAILS = [
  email(
    'invoice',
    { importance: 93, needsReply: true, category: 'CUSTOMER' },
    {
      sortTs: '2026-10-01T10:00:00Z',
      senderName: 'Casey',
    }
  ),
  email(
    'report',
    { importance: 80, category: 'SECURITY' },
    {
      sortTs: '2026-10-08T10:00:00Z',
      linkId: 'inbox-b',
    }
  ),
  email(
    'plan',
    { importance: 61, needsFollowUp: true, category: 'TEAM' },
    {
      sortTs: '2026-10-05T10:00:00Z',
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
      focusSort: 'importance',
      ...input,
    },
    context
  ).map((selected) => selected.id);
}

describe('selectFocusEmails', () => {
  it('keeps the server order by importance', () => {
    expect(select({})).toEqual(['invoice', 'report', 'plan']);
  });

  it('orders by recency on request', () => {
    expect(select({ focusSort: 'recent' })).toEqual([
      'report',
      'plan',
      'invoice',
    ]);
  });

  it('filters by Focus category and flags', () => {
    expect(select({ facets: { focus: ['focus-reply-needed'] } })).toEqual([
      'invoice',
    ]);
    expect(select({ facets: { focus: ['focus-follow-up'] } })).toEqual([
      'plan',
    ]);
    expect(select({ facets: { focus: ['focus-security'] } })).toEqual([
      'report',
    ]);
    expect(select({ facets: { focus: ['focus-known'] } })).toEqual([]);
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
    select({ focusSort: 'recent' });
    expect(EMAILS.map((selected) => selected.id)).toEqual([
      'invoice',
      'report',
      'plan',
    ]);
  });

  it('ignores Status and Done filters, which Focus does not offer', () => {
    const [invoice, ...rest] = EMAILS;
    expect(
      select({ facets: { read: ['read'], done: ['done'] } }, [
        { ...invoice, isRead: true },
        ...rest,
      ])
    ).toEqual(['invoice', 'report', 'plan']);
  });

  it('drops threads marked done', () => {
    const [invoice, ...rest] = EMAILS;
    expect(select({}, [{ ...invoice, done: true }, ...rest])).toEqual([
      'report',
      'plan',
    ]);
  });
});
