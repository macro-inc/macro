import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import type {
  SoupAstItemsQuery,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { CrmActivityTab } from '../core/navigation';
import { useCrmActivityQuery } from './activity';
import { crmActivityBody } from './activity-filter';

const tabs: CrmActivityTab[] = ['tasks', 'notes', 'calls', 'email'];

describe('CRM activity queries', () => {
  it.each(tabs)(
    'keeps %s within the GraphQL ingress budget without enumerating records',
    (tab) => {
      const input = makeGraphqlSoupInput({
        params: { limit: 100, sort_method: 'updated_at' },
        body: crmActivityBody(tab),
      });
      const pending: unknown[] = [input];
      let nodes = 0;
      while (pending.length) {
        const value = pending.pop();
        nodes++;
        if (value !== null && typeof value === 'object')
          pending.push(...Object.values(value));
      }
      expect(nodes).toBeLessThan(100);
      expect(input).toMatchObject({
        initial: { filters: { crmAssociation: { activity: true } } },
      });
    }
  );

  it('uses the authorized activity scope without a generic property filter for calls', () => {
    const body = crmActivityBody('calls');
    expect(body.crma).toBe('activity');
    expect(body).not.toHaveProperty('callf');
    expect(body).not.toHaveProperty('propf');
  });

  it('keeps email in the viewer mailbox without excluding unlinked matching threads', () => {
    const body = crmActivityBody('email');
    expect(body).not.toHaveProperty('ef');
    expect(body).not.toHaveProperty('ecd');
    expect(body).not.toHaveProperty('eca');
    expect(body.emailView).toBe('all');
  });

  it('starts with the authenticated viewer and delegates errors, retries, and paging to Soup', () => {
    createRoot((dispose) => {
      const [userId, setUserId] = createSignal<string>();
      const [tab, setTab] = createSignal<CrmActivityTab>('tasks');
      const query: SoupAstItemsQuery = {
        data: undefined,
        error: new Error('Request failed'),
        isPending: false,
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        isEnabled: true,
        hasNextPage: false,
        transport: 'graphql',
        fetchNextPage: vi.fn(async () => {}),
        refetch: vi.fn(async () => {}),
        resetToInitialPage: vi.fn(),
        refresh: vi.fn(async () => {}),
      };
      const createQuery = vi.fn<typeof useSoupAstItemsQuery>(() => query);
      const source = useCrmActivityQuery(createQuery, tab, userId);
      const [args, options] = createQuery.mock.calls[0];
      expect(options?.().enabled).toBe(false);
      setUserId('macro|viewer@example.com');
      expect(options?.().enabled).toBe(true);
      expect(args().body).toEqual(crmActivityBody('tasks'));
      setTab('calls');
      expect(args().body).toEqual(crmActivityBody('calls'));
      expect(source).toBe(query);
      expect(source.error).toBe(query.error);
      expect(source.refetch).toBe(query.refetch);
      expect(source.fetchNextPage).toBe(query.fetchNextPage);
      dispose();
    });
  });
});
