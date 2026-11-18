import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('listCompanies sends the filters and returns handles with the matched count', async () => {
  const requests: URL[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(new URL(request.url));
      return Response.json({
        companies: [
          {
            id: 'company-1',
            name: 'Example company',
            domains: ['example.test'],
            hidden: false,
            lastInteraction: '2026-11-01T00:00:00Z',
            stage: { label: 'Customer', optionId: 'option-1' },
            ownerUserId: 'macro|owner@example.test',
            revenue: 1200,
          },
          {
            id: 'company-2',
            name: null,
            domains: [],
            hidden: true,
            lastInteraction: '2026-10-01T00:00:00Z',
            stage: null,
            ownerUserId: null,
            revenue: null,
          },
        ],
        totalMatching: 7,
        summary: 'Found 7 companies.',
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });

  const listing = await macro.crm.listCompanies({
    search: 'example',
    stage: 'Customer',
    owner: macro.users.byId('macro|owner@example.test'),
    includeHidden: true,
    limit: 2,
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].pathname).toBe('/crm/companies');
  expect(Object.fromEntries(requests[0].searchParams)).toEqual({
    search: 'example',
    stage: 'Customer',
    ownerUserId: 'macro|owner@example.test',
    includeHidden: 'true',
    limit: '2',
  });
  expect(listing.totalMatching).toBe(7);
  const [first, second] = listing.companies;
  expect(first.company.id).toBe('company-1');
  expect(first.name).toBe('Example company');
  expect(first.stage).toEqual({ label: 'Customer', optionId: 'option-1' });
  expect(first.owner?.id).toBe('macro|owner@example.test');
  expect(first.revenue).toBe(1200);
  expect(second.company.id).toBe('company-2');
  expect(second.name).toBeUndefined();
  expect(second.hidden).toBe(true);
  expect(second.stage).toBeUndefined();
  expect(second.owner).toBeUndefined();
  expect(second.revenue).toBeUndefined();
});
