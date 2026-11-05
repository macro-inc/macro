import { afterEach, expect, test } from 'bun:test';
import type { PipelineEntry as PipelineEntryRecord } from '../generated/storage/types.gen';
import { Company } from '../src/entities/crm/company';
import { Contact } from '../src/entities/crm/contact';
import { Document } from '../src/entities/documents/document';
import { Macro, PipelineEntry } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const pipelineRecord = {
  id: 'sales',
  teamId: 'team',
  userId: 'macro|owner@example.com',
  name: 'Sales',
  recordType: 'company',
  databaseId: 'database',
  tableId: 'table',
  primaryColumnId: 'company',
  sharing: 'team',
  createdAt: '2026-10-01T00:00:00Z',
  trashedAt: null,
  grant: 'owner',
};

const acmeEntry: PipelineEntryRecord = {
  entryId: 'entry-acme',
  record: { id: 'acme', name: 'Acme', detail: 'acme.com' },
  fields: {
    Stage: { type: 'labels', value: ['Demo'] },
    Revenue: { type: 'number', value: 1000 },
  },
};

test('entries are written and read by field name and handle, never by column id', async () => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      const path = new URL(request.url).pathname + new URL(request.url).search;
      const text = await request.text();
      const body = text ? JSON.parse(text) : undefined;
      requests.push({ method: request.method, path, body });
      if (path === '/crm/pipelines/sales') return Response.json(pipelineRecord);
      if (path === '/crm/pipelines/sales/entries' && request.method === 'POST')
        return Response.json({
          added: [acmeEntry],
          alreadyPresent: [
            {
              entryId: 'entry-globex',
              record: { id: 'globex', name: 'Globex', detail: 'globex.com' },
              fields: {},
            },
          ],
          version: 4,
        });
      if (path === '/crm/pipelines/sales/entries/find')
        return Response.json({
          pipeline: { ...pipelineRecord, fields: [], version: 4 },
          entries: [acmeEntry],
          matched: 1,
          complete: true,
          counts: [
            {
              field: 'Stage',
              counts: [{ label: 'Demo', count: 1 }],
              empty: 0,
            },
          ],
          totals: [{ field: 'Revenue', sum: 1000 }],
        });
      if (path === '/crm/pipelines/sales/entries' && request.method === 'PATCH')
        return Response.json({
          updated: [
            {
              entryId: 'entry-acme',
              record: acmeEntry.record,
              changes: [
                {
                  field: 'Stage',
                  before: { type: 'labels', value: ['Demo'] },
                  after: { type: 'labels', value: ['Won'] },
                },
                {
                  field: 'Owner',
                  before: { type: 'references', value: ['macro|a@b.test'] },
                  after: null,
                },
              ],
            },
          ],
          version: 5,
        });
      if (path === '/crm/pipelines/sales/entries/remove')
        return Response.json({ removed: [acmeEntry], version: 6 });
      if (path === '/crm/pipelines/sales/export')
        return Response.json({
          documentId: 'csv-file',
          fileName: 'Sales',
          rows: 1,
          complete: true,
        });
      throw new Error(`unexpected ${request.method} ${path}`);
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const pipeline = macro.crm.pipelines.byId('sales');
  const acme = macro.crm.companyById('acme');

  const added = await pipeline.addRecords([
    { record: acme, set: { Stage: 'Demo', Revenue: 1000, Owner: null } },
    { record: { email: 'sam@globex.test' }, set: { Tags: ['a', 'b'] } },
  ]);
  expect(requests[0]?.body).toEqual({
    entries: [
      {
        recordId: 'acme',
        set: [
          { field: 'Stage', value: 'Demo' },
          { field: 'Revenue', value: '1000' },
          { field: 'Owner' },
        ],
      },
      {
        email: 'sam@globex.test',
        set: [{ field: 'Tags', values: ['a', 'b'] }],
      },
    ],
    allowDuplicates: false,
  });
  const [entry] = added.added;
  expect(entry).toBeInstanceOf(PipelineEntry);
  expect(entry?.record).toBeInstanceOf(Company);
  expect(entry?.record.id).toBe('acme');
  expect(entry?.fields.Stage).toEqual({ type: 'labels', value: ['Demo'] });
  expect(added.alreadyPresent[0]?.recordName).toBe('Globex');
  expect(added.version).toBe(4);

  const found = await pipeline.find({
    where: { Stage: ['Demo', 'Won'] },
    records: [acme],
    sortBy: 'Revenue',
    descending: true,
  });
  expect(requests.at(-1)?.body).toEqual({
    filters: [{ field: 'Stage', values: ['Demo', 'Won'] }],
    recordIds: ['acme'],
    sortBy: 'Revenue',
    descending: true,
  });
  expect(found.totals).toEqual([{ field: 'Revenue', sum: 1000 }]);
  expect(found.counts[0]?.counts).toEqual([{ label: 'Demo', count: 1 }]);
  expect(found.version).toBe(4);

  const moved = await found.entries[0]?.update(
    { Stage: 'Won', Owner: null },
    { baseVersion: found.version },
  );
  expect(requests.at(-1)?.body).toEqual({
    updates: [
      {
        entryId: 'entry-acme',
        set: [{ field: 'Stage', value: 'Won' }, { field: 'Owner' }],
      },
    ],
    baseVersion: 4,
  });
  expect(moved?.changes).toEqual([
    {
      field: 'Stage',
      before: { type: 'labels', value: ['Demo'] },
      after: { type: 'labels', value: ['Won'] },
    },
    {
      field: 'Owner',
      before: { type: 'references', value: ['macro|a@b.test'] },
      after: undefined,
    },
  ]);
  expect(moved?.entry.fields).toEqual({
    Stage: { type: 'labels', value: ['Won'] },
  });
  expect(moved?.version).toBe(5);

  const sam = macro.crm.contactById('sam');
  expect(sam).toBeInstanceOf(Contact);
  const removed = await pipeline.removeRecords(
    [found.entries[0], sam].filter((target) => target !== undefined),
  );
  expect(requests.at(-1)?.body).toEqual({
    entryIds: ['entry-acme'],
    recordIds: ['sam'],
  });
  expect(removed.removed[0]?.id).toBe('entry-acme');

  const exported = await pipeline.exportCsvFile();
  expect(exported.document).toBeInstanceOf(Document);
  expect(exported.document.id).toBe('csv-file');

  const elsewhere = PipelineEntry.from(
    macro._client,
    macro.crm.pipelines.byId('renewals'),
    'company',
    acmeEntry,
  );
  await expect(pipeline.removeRecords([elsewhere])).rejects.toThrow(
    'Entry belongs to another pipeline',
  );
  expect(
    requests.filter((request) => request.path === '/crm/pipelines/sales'),
  ).toHaveLength(1);
});
