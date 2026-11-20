import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

const NIL = '00000000-0000-0000-0000-000000000000';

const searches = vi.hoisted(() => ({ requests: [] as unknown[] }));

vi.mock('@service-search/client', () => ({
  searchClient: {
    search: async (args: { request: unknown }) => {
      searches.requests.push(args.request);
      return ok({
        next_cursor: null,
        results: [
          company('company-1', 'Northwind Traders', false),
          company('company-2', 'Archived Co', true),
        ],
      });
    },
  },
}));

function company(id: string, name: string, hidden: boolean) {
  return {
    type: 'company',
    id,
    name,
    hidden,
    teamId: 'team-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    domains: [
      {
        id: `${id}-domain`,
        companyId: id,
        domain: `${id}.example.com`,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
}

import { crmCompanySearchQueryOptions } from './company-search';

afterEach(() => {
  searches.requests.length = 0;
});

describe('the company search', () => {
  it('asks the search service for team companies alone, by name', async () => {
    const client = new QueryClient();
    const companies = await client.fetchInfiniteQuery(
      crmCompanySearchQueryOptions('north', true)
    );
    expect(companies.pages).toHaveLength(1);
    const [request] = searches.requests as {
      query: string;
      include_crm: boolean;
      search_on: string;
      filters: Record<string, Record<string, unknown>>;
    }[];
    expect(request.query).toBe('north');
    expect(request.include_crm).toBe(true);
    expect(request.search_on).toBe('name');
    expect(request.filters.crm_company_filters).toEqual({ hidden: false });
    expect(request.filters.call_filters.call_ids).toEqual([NIL]);
    expect(request.filters.document_filters.document_ids).toEqual([NIL]);
    expect(request.filters.email_filters.email_thread_ids).toEqual([NIL]);
    expect(request.filters.channel_filters.channel_ids).toEqual([NIL]);
  });

  it('lists the visible companies it returns', async () => {
    const client = new QueryClient();
    const options = crmCompanySearchQueryOptions('north', true);
    const data = await client.fetchInfiniteQuery(options);
    const listed = options.select?.(data) ?? [];
    expect(listed.map((entity) => entity.name)).toEqual(['Northwind Traders']);
    expect(listed[0]?.domains[0]?.domain).toBe('company-1.example.com');
  });
});
