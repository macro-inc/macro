import type { DatabaseOp } from '@core/database-sql/generated/types';
import { ThrownResultError } from '@core/util/result';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { Pipeline } from '../core/pipeline';
import type { CrmRecordDependencies } from './dependencies';
import { createPipelineTransfer } from './pipeline-transfer';

const refreshGraphqlLists = vi.hoisted(() => vi.fn(async () => undefined));
const creates = vi.hoisted(() => ({ company: vi.fn(), contact: vi.fn() }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlCacheHost: () => undefined,
}));
vi.mock('@service-storage/graphql-crm-create', () => ({
  createGraphqlCrmCompany: creates.company,
  createGraphqlCrmContact: creates.contact,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: refreshGraphqlLists,
}));
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
  creates.company.mockReset().mockImplementation(async ({ domain }) => {
    // A slow create, so concurrent contacts at one domain overlap it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (domain === 'gmail.com')
      throw new ThrownResultError([
        { code: 'BAD_REQUEST', message: 'generic domain' },
      ]);
    return { id: `${domain}-id` };
  });
  creates.contact.mockReset().mockImplementation(async ({ email }) => ({
    id: `${email}-id`,
  }));
  const storage = {
    getContactByEmail: vi.fn(async ({ email }: { email: string }) =>
      email === 'down@acme.com'
        ? err([{ code: 'SERVER_ERROR', message: 'unavailable' }])
        : ok({ contact: null })
    ),
    applyCrmPipelineOps: vi.fn(
      async (
        _id: string,
        request: { ops: DatabaseOp[] }
      ): Promise<
        Awaited<
          ReturnType<CrmRecordDependencies['storage']['applyCrmPipelineOps']>
        >
      > => {
        applied.push(request.ops);
        return ok({ results: [], changes: [] });
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
  it('isolates refused entries and only remembers options from committed writes', async () => {
    const { transfer, storage } = setup();
    const saved: DatabaseOp[][] = [];
    storage.applyCrmPipelineOps.mockImplementation(async (_id, request) => {
      const insert = request.ops.find((op) => op.kind === 'rows');
      if (insert?.kind !== 'rows' || insert.change.kind !== 'insert')
        throw new Error('Missing insert');
      if (
        insert.change.rows.some((row) =>
          row.some((cell) => cell.column === 'bad')
        )
      )
        return err([
          {
            code: 'INVALID_OP',
            refusal: null,
            message: 'Fill in Amount before entering Lead.',
          },
        ]);
      saved.push(request.ops);
      return ok({ results: [], changes: [] });
    });
    const stageCell = {
      column: 'stage',
      value: { type: 'options' as const, value: [{ label: 'Negotiation' }] },
    };
    const rejected = vi.fn();
    await transfer.insertRows(
      [
        [stageCell, { column: 'bad', value: { type: 'clear' } }],
        [stageCell],
        [stageCell],
      ],
      [stage],
      rejected
    );
    expect(rejected).toHaveBeenCalledExactlyOnceWith(
      0,
      'Fill in Amount before entering Lead.'
    );
    expect(
      saved.flatMap((ops) => ops.filter((op) => op.kind === 'column'))
    ).toHaveLength(1);
    expect(
      saved.flatMap((ops) =>
        ops.flatMap((op) =>
          op.kind === 'rows' && op.change.kind === 'insert'
            ? op.change.rows
            : []
        )
      )
    ).toHaveLength(2);
  });

  it('matches companies by domain and creates the missing ones once', async () => {
    const { transfer } = setup();
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
    expect(creates.company.mock.calls.map(([input]) => input)).toEqual([
      { name: 'Beta', domain: 'beta.io' },
      { name: 'Gmail', domain: 'gmail.com' },
    ]);
  });

  it('creates one company for new contacts that share its domain', async () => {
    const { transfer } = setup('contact');
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
    expect(creates.contact).toHaveBeenCalledTimes(3);
    expect(creates.company.mock.calls.map(([input]) => input)).toEqual([
      { name: 'beta.io', domain: 'beta.io' },
    ]);
    expect(creates.contact.mock.calls.map(([input]) => input)).toEqual(
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

  it('reads GraphQL lists that can show the imported records again', async () => {
    refreshGraphqlLists.mockClear();
    const { transfer } = setup();
    await transfer.refresh();
    expect(refreshGraphqlLists).toHaveBeenCalledOnce();
    const [{ where }] = refreshGraphqlLists.mock.calls[0] as unknown as [
      { where: (body: unknown) => boolean },
    ];
    const excluded = { l: { id: '00000000-0000-0000-0000-000000000000' } };
    expect(where({ ccf: { l: { id: 'other' } } })).toBe(true);
    expect(where({ ccf: excluded, crmf: { l: { id: 'other' } } })).toBe(true);
    expect(where({ ccf: excluded })).toBe(false);
  });
});
