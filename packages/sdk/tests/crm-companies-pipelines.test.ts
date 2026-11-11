import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Request_ = { method: string; path: string; query: string; body: unknown };

function record(respond: (request: Request_) => unknown): Request_[] {
  const requests: Request_[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const text = await request.text();
      const seen = {
        method: request.method,
        path: url.pathname,
        query: url.search,
        body: text ? JSON.parse(text) : undefined,
      };
      requests.push(seen);
      return Response.json(respond(seen));
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

const macro = () =>
  new Macro({ token: 'token', hosts: { storage: 'https://storage.test' } });

const pipeline = {
  id: 'pipeline-1',
  teamId: 'team-1',
  userId: 'macro|owner@example.com',
  name: 'Hiring',
  recordType: 'contact',
  databaseId: 'database-1',
  tableId: 'table-1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  accessLevel: 'owner',
  sharing: 'private',
};

test('listCompanies reads the listing and returns handles, not ids', async () => {
  const requests = record(() => ({
    totalMatching: 3,
    companies: [
      {
        id: 'company-1',
        name: 'Acme',
        domains: ['acme.example.com'],
        hidden: false,
        lastInteraction: '2026-11-10T00:00:00Z',
        stage: { optionId: 'option-1', label: 'Customer' },
        ownerUserId: 'macro|owner@example.com',
        revenue: 1200,
      },
      {
        id: 'company-2',
        name: null,
        domains: [],
        hidden: true,
        lastInteraction: '2026-11-09T00:00:00Z',
        stage: null,
        ownerUserId: null,
        revenue: null,
      },
    ],
  }));
  const client = macro();
  const listing = await client.crm.listCompanies({
    stage: 'customer',
    owner: client.users.byId('macro|owner@example.com'),
    includeHidden: true,
    limit: 2,
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.path).toBe('/crm/companies/list');
  const query = new URLSearchParams(requests[0]?.query);
  expect(Object.fromEntries(query)).toEqual({
    stage: 'customer',
    ownerUserId: 'macro|owner@example.com',
    includeHidden: 'true',
    limit: '2',
  });
  expect(listing.totalMatching).toBe(3);
  const [acme, hidden] = listing.companies;
  expect(acme?.company.id).toBe('company-1');
  expect(acme?.stage).toBe('Customer');
  expect(acme?.owner?.id).toBe('macro|owner@example.com');
  expect(acme?.revenue).toBe(1200);
  expect(hidden?.name).toBeUndefined();
  expect(hidden?.stage).toBeUndefined();
  expect(hidden?.owner).toBeUndefined();
});

test('pipelines.create sends stages and fields to the workflow route', async () => {
  const requests = record(() => ({ ...pipeline, fields: [], version: 1 }));
  const created = await macro().crm.pipelines.create({
    name: 'Hiring',
    recordType: 'contact',
    stages: ['Sourced', 'Screen', 'Offer'],
    fields: [{ name: 'Level', type: 'select', options: ['Junior', 'Senior'] }],
  });

  expect(created.id).toBe('pipeline-1');
  expect(requests).toEqual([
    {
      method: 'POST',
      path: '/crm/pipelines/create',
      query: '',
      body: {
        name: 'Hiring',
        recordType: 'contact',
        stages: ['Sourced', 'Screen', 'Offer'],
        fields: [
          { name: 'Level', type: 'select', options: ['Junior', 'Senior'] },
        ],
      },
    },
  ]);
});

test('pipelines.create without stages or fields keeps the plain create', async () => {
  const requests = record(() => pipeline);
  await macro().crm.pipelines.create({ name: 'Hiring', stages: [] });

  expect(requests).toEqual([
    {
      method: 'POST',
      path: '/crm/pipelines',
      query: '',
      body: { name: 'Hiring' },
    },
  ]);
});
