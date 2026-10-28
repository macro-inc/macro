import type { CellWrite } from '@core/database-sql/generated/types';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { PipelineTransfer } from '../context/pipelines';
import type { Pipeline } from '../core/pipeline';
import type { PipelineCsvRow } from '../core/pipeline-csv';
import {
  createPipelineExport,
  createPipelineImport,
} from './pipeline-transfer';

const pipeline: Pipeline = {
  id: 'pipeline',
  teamId: 'team',
  name: 'Q4 Deals',
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
const columns: DatabaseViewColumn[] = [
  {
    id: 'company',
    name: 'Company',
    dataType: 'ENTITY',
    specificEntityType: 'COMPANY',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'stage',
    name: 'Stage',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    options: [{ id: 'lead', label: 'Lead', color: null }],
    writable: true,
  },
];
const file = (text: string) => ({ size: text.length, text: async () => text });

function fakeTransfer(rows: PipelineCsvRow[]) {
  const inserted: CellWrite[][] = [];
  let failInsert = false;
  const transfer = {
    readTable: vi.fn(async () => ({ columns, rows: [...rows] })),
    describeRecords: vi.fn(
      async () => new Map([['acme-id', { name: 'Acme', key: 'acme.com' }]])
    ),
    resolveRecords: vi.fn(
      async () =>
        new Map([
          ['acme.com', 'acme-id'],
          ['beta.io', 'beta-id'],
        ])
    ),
    insertRows: vi.fn(async (added: readonly CellWrite[][]) => {
      if (failInsert) throw new Error('offline');
      inserted.push(...added);
    }),
    refresh: vi.fn(async () => {}),
  } satisfies PipelineTransfer;
  return {
    transfer,
    inserted,
    failNextInsert: (fail: boolean) => {
      failInsert = fail;
    },
  };
}

describe('pipeline import', () => {
  it('adds records the pipeline lacks and retries only what is missing', async () => {
    const { transfer, inserted, failNextInsert } = fakeTransfer([
      { cells: { company: 'acme-id', stage: 'Lead' } },
    ]);
    const { state, dispose } = createRoot((dispose) => ({
      state: createPipelineImport(pipeline, transfer),
      dispose,
    }));
    await state.read(
      file(
        '\uFEFFCompany,Domain,Stage\nAcme,acme.com,Lead\nBeta,beta.io,Won\nGmail,gmail.com,Lead\n'
      )
    );
    expect(state.error()).toBe('');
    expect(state.plan()?.rows).toHaveLength(3);
    failNextInsert(true);
    await state.run();
    expect(state.error()).toContain('Retry');
    expect(state.plan()?.rows).toHaveLength(3);
    failNextInsert(false);
    await state.run();
    expect(state.result()).toEqual({ added: 1, present: 1, unresolved: 1 });
    expect(inserted).toEqual([
      [
        {
          column: 'company',
          value: {
            type: 'entities',
            value: [{ entityType: 'COMPANY', entityId: 'beta-id' }],
          },
        },
        {
          column: 'stage',
          value: { type: 'options', value: [{ label: 'Won' }] },
        },
      ],
    ]);
    expect(transfer.refresh).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('exports each entry with its company name and domain', async () => {
    const { transfer } = fakeTransfer([
      { cells: { company: 'acme-id', stage: 'Lead' } },
    ]);
    const download = vi.fn(async () => ({ saved: true }));
    const { state, dispose } = createRoot((dispose) => ({
      state: createPipelineExport(() => pipeline, transfer, download),
      dispose,
    }));
    expect(await state.run()).toBe('saved');
    expect(download).toHaveBeenCalledWith(
      '\uFEFFCompany,Domain,Stage\nAcme,acme.com,Lead',
      expect.stringMatching(/^macro-q4-deals-\d{4}-\d{2}-\d{2}\.csv$/)
    );
    dispose();
  });

  it('keeps two deals for one new company as two entries', async () => {
    const { transfer, inserted } = fakeTransfer([]);
    const { state, dispose } = createRoot((dispose) => ({
      state: createPipelineImport(pipeline, transfer),
      dispose,
    }));
    await state.read(
      file('Company,Domain,Stage\nBeta,beta.io,Lead\nBeta,beta.io,Won\n')
    );
    await state.run();
    expect(state.result()).toEqual({ added: 2, present: 0, unresolved: 0 });
    expect(inserted).toHaveLength(2);
    dispose();
  });
});
