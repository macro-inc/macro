import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('listWithFields returns every pipeline with its fields, stages and version in one call', async () => {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
      return Response.json([
        {
          id: 'sales',
          name: 'Sales',
          recordType: 'company',
          sharing: 'team',
          grant: 'edit',
          userId: 'macro|owner@example.test',
          teamId: 'team',
          databaseId: 'database',
          tableId: 'table',
          primaryColumnId: 'company',
          createdAt: '2026-11-01T00:00:00Z',
          trashedAt: null,
          fields: [
            {
              name: 'Company',
              type: 'company',
              multiple: false,
              options: [],
              required: true,
              readOnly: false,
            },
            {
              name: 'Stage',
              type: 'select',
              multiple: false,
              options: ['Prospect', 'Demo', 'Won'],
              required: false,
              readOnly: false,
            },
          ],
          version: 7,
        },
      ]);
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });

  const [listed, ...rest] = await macro.crm.pipelines.listWithFields();

  expect(rest).toEqual([]);
  expect(listed.version).toBe(7);
  expect(listed.fields.map((field) => field.name)).toEqual([
    'Company',
    'Stage',
  ]);
  expect(listed.fields[1].options).toEqual(['Prospect', 'Demo', 'Won']);
  expect(listed.pipeline.id).toBe('sales');
  // The handle is seeded from the same response: no second read.
  expect(await listed.pipeline.name()).toBe('Sales');
  expect(await listed.pipeline.recordType()).toBe('company');
  expect(requests).toEqual(['GET /crm/pipelines/details']);
});
