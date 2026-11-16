import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('create sends stages and fields in one call and returns the pipeline', async () => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      const path = new URL(request.url).pathname;
      requests.push({
        method: request.method,
        path,
        body: JSON.parse(await request.text()),
      });
      return Response.json({
        id: 'hiring',
        teamId: 'team',
        userId: 'macro|owner@example.com',
        name: 'Hiring',
        recordType: 'contact',
        databaseId: 'database',
        tableId: 'table',
        primaryColumnId: 'contact',
        sharing: 'private',
        createdAt: '2026-11-12T00:00:00Z',
        trashedAt: null,
        grant: 'owner',
        fields: [
          {
            name: 'Stage',
            type: 'select',
            multiple: false,
            options: ['Sourced', 'Interview', 'Hired'],
            required: false,
            readOnly: false,
          },
        ],
        version: 2,
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });

  const pipeline = await macro.crm.pipelines.create({
    name: 'Hiring',
    recordType: 'contact',
    stages: ['Sourced', 'Interview', 'Hired'],
    fields: [
      { name: 'Role', type: 'select', options: ['Engineer', 'Designer'] },
    ],
  });

  expect(requests).toEqual([
    {
      method: 'POST',
      path: '/crm/pipelines/create',
      body: {
        name: 'Hiring',
        recordType: 'contact',
        stages: ['Sourced', 'Interview', 'Hired'],
        fields: [
          { name: 'Role', type: 'select', options: ['Engineer', 'Designer'] },
        ],
      },
    },
  ]);
  expect(pipeline.id).toBe('hiring');
  expect(await pipeline.name()).toBe('Hiring');
});
