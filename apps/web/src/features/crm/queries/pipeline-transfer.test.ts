import type { DatabaseOp } from '@core/database-sql/generated/types';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { Pipeline } from '../core/pipeline';
import type { CrmRecordDependencies } from './dependencies';
import { createPipelineTransfer } from './pipeline-transfer';

vi.mock('./export', () => ({
  fetchCrmExportCompanies: async () => [
    { id: 'acme-id', name: 'Acme', domains: [{ domain: 'acme.com' }] },
  ],
}));

const pipeline: Pipeline = {
  id: 'pipeline',
  teamId: 'team',
  name: 'Deals',
  userId: 'macro|owner@macro.com',
  recordType: 'company',
  databaseId: 'database',
  tableId: 'table',
  primaryColumnId: 'company',
  sharing: 'team',
  grant: 'owner',
  createdAt: '2026-10-01T00:00:00Z',
  trashedAt: null,
};
const stage: DatabaseViewColumn = {
  id: 'stage',
  name: 'Stage',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  options: [{ id: 'lead', label: 'Lead', color: null }],
  writable: true,
};

function setup(recordType: Pipeline['recordType'] = 'company') {
  const applied: DatabaseOp[][] = [];
  const storage = {
    createCompany: vi.fn(async ({ domain }: { domain: string }) => {
      // A slow create, so concurrent contacts at one domain overlap it.
      await new Promise((resolve) => setTimeout(resolve, 10));
      return domain === 'gmail.com'
        ? err([{ code: 'BAD_REQUEST', message: 'generic domain' }])
        : ok({ id: `${domain}-id` });
    }),
    getContactByEmail: vi.fn(async ({ email }: { email: string }) =>
      email === 'down@acme.com'
        ? err([{ code: 'SERVER_ERROR', message: 'unavailable' }])
        : ok({ contact: null })
    ),
    createContact: vi.fn(async ({ email }: { email: string }) =>
      ok({ id: `${email}-id` })
    ),
    applyCrmPipelineOps: vi.fn(
      async (_id: string, request: { ops: DatabaseOp[] }) => {
        applied.push(request.ops);
        return ok({ results: [] });
      }
    ),
  };
  const deps = {
    storage,
    client: new QueryClient(),
  } as unknown as CrmRecordDependencies;
  return {
    transfer: createPipelineTransfer(deps, { ...pipeline, recordType }),
    storage,
    applied,
  };
}

describe('pipeline transfer', () => {
  it('matches companies by domain and creates the missing ones once', async () => {
    const { transfer, storage } = setup();
    const ids = await transfer.resolveRecords(
      [
        { name: 'Acme', key: 'acme.com' },
        { name: 'Beta', key: 'beta.io' },
        { name: 'Beta again', key: 'beta.io' },
        { name: 'Gmail', key: 'gmail.com' },
      ],
      new AbortController().signal,
      () => {}
    );
    expect([...ids]).toEqual([
      ['acme.com', 'acme-id'],
      ['beta.io', 'beta.io-id'],
    ]);
    expect(storage.createCompany.mock.calls.map(([input]) => input)).toEqual([
      { name: 'Beta', domain: 'beta.io' },
      { name: 'Gmail', domain: 'gmail.com' },
    ]);
  });

  it('creates one company for new contacts that share its domain', async () => {
    const { transfer, storage } = setup('contact');
    const ids = await transfer.resolveRecords(
      [
        { name: 'Jane', key: 'jane@beta.io' },
        { name: 'Raj', key: 'raj@beta.io' },
        { name: 'Ana', key: 'ana@acme.com' },
        { name: 'Down', key: 'down@acme.com' },
      ],
      new AbortController().signal,
      () => {}
    );
    expect(ids.size).toBe(3);
    expect(ids.has('down@acme.com')).toBe(false);
    expect(storage.createContact).toHaveBeenCalledTimes(3);
    expect(storage.createCompany.mock.calls.map(([input]) => input)).toEqual([
      { name: 'beta.io', domain: 'beta.io' },
    ]);
    expect(storage.createContact.mock.calls.map(([input]) => input)).toEqual(
      expect.arrayContaining([
        { companyId: 'beta.io-id', name: 'Jane', email: 'jane@beta.io' },
        { companyId: 'beta.io-id', name: 'Raj', email: 'raj@beta.io' },
        { companyId: 'acme-id', name: 'Ana', email: 'ana@acme.com' },
      ])
    );
  });

  it('adds a missing stage once, ahead of the first batch that names it', async () => {
    const { transfer, applied } = setup();
    const row = (label: string) => [
      {
        column: 'stage',
        value: { type: 'options' as const, value: [{ label }] },
      },
    ];
    await transfer.insertRows(
      [
        ...Array.from({ length: 500 }, () => row('Lead')),
        row('Won'),
        row('won'),
      ],
      [stage]
    );
    expect(applied).toHaveLength(2);
    expect(applied[0]).toHaveLength(1);
    expect(applied[1]).toHaveLength(2);
    expect(applied[1][0]).toMatchObject({
      kind: 'column',
      column: 'stage',
      change: { kind: 'add_options', options: [{ label: 'Won' }] },
    });
  });
});
