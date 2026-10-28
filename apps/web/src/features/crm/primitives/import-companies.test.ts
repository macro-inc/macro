import type { CellWrite } from '@core/database-sql/generated/types';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { PipelineTransfer } from '../context/pipelines';
import { createCrmCsv } from '../core/export';
import type { Pipeline } from '../core/pipeline';
import { createCompanyImport } from './import-companies';

const file = (text: string, name = 'companies.csv') => ({
  name,
  size: text.length,
  text: async () => text,
});

function setup(
  create: (row: {
    name: string;
    domain: string;
  }) => Promise<'created' | 'exists'>
) {
  const refresh = vi.fn(async () => {});
  const { state, dispose } = createRoot((dispose) => ({
    state: createCompanyImport({ create, refresh }),
    dispose,
  }));
  return { state, dispose, refresh };
}

describe('company import', () => {
  it('imports a CRM companies export', async () => {
    const create = vi.fn(async () => 'created' as const);
    const { state, dispose, refresh } = setup(create);
    const companies = Array.from({ length: 150 }, (_, index) => ({
      name: `Company ${index}`,
      domains: `company${index}.com; alias${index}.com`,
      stage: 'Churned',
    }));
    await state.read(
      file(
        createCrmCsv(
          [
            { id: 'name', label: 'Company' },
            { id: 'domains', label: 'Domains' },
            { id: 'stage', label: 'Stage' },
          ],
          [
            ...companies,
            { name: '=Formula Co', domains: 'formula.co', stage: '' },
            { name: 'No domain', domains: '', stage: '' },
            { name: 'Repeat', domains: 'company0.com', stage: '' },
          ]
        )
      )
    );
    expect(state.error()).toBe('');
    expect(state.rows()).toHaveLength(151);
    expect(state.rows()[0]).toEqual({
      name: 'Company 0',
      domain: 'company0.com',
    });
    expect(state.rows()[150]).toEqual({
      name: '=Formula Co',
      domain: 'formula.co',
    });
    expect(state.skipped()).toBe(2);
    await state.run();
    expect(create).toHaveBeenCalledTimes(151);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(state.completed()).toBe(151);
    expect(state.rows()).toEqual([]);
    dispose();
  });

  it('counts companies the team already tracks without failing them', async () => {
    const { state, dispose } = setup(async (row) =>
      row.domain === 'known.example' ? 'exists' : 'created'
    );
    await state.read(
      file('name,domain\nKnown,known.example\nNew,https://www.new.example/')
    );
    await state.run();
    expect(state.completed()).toBe(1);
    expect(state.existing()).toBe(1);
    expect(state.error()).toBe('');
    dispose();
  });

  it('retries only failed rows and preserves the successful count', async () => {
    let fail = true;
    const create = vi.fn(async (row: { name: string; domain: string }) => {
      if (row.name === 'Retry' && fail) throw new Error('temporary failure');
      return 'created' as const;
    });
    const { state, dispose } = setup(create);
    await state.read(
      file('Name,Domain\nDone,DONE.EXAMPLE\nRetry,retry.example')
    );
    expect(state.error()).toBe('');
    await state.run();
    expect(state.completed()).toBe(1);
    expect(state.rows()).toEqual([{ name: 'Retry', domain: 'retry.example' }]);
    expect(state.error()).toContain('Successful rows will not be retried');
    fail = false;
    await state.run();
    expect(state.completed()).toBe(2);
    expect(state.rows()).toEqual([]);
    expect(create.mock.calls.map(([row]) => row.name)).toEqual([
      'Done',
      'Retry',
      'Retry',
    ]);
    dispose();
  });

  it('rejects oversized files and files without domains before any mutation', async () => {
    const create = vi.fn(async () => 'created' as const);
    const { state, dispose } = setup(create);
    await state.read(file('x'.repeat(5 * 1024 * 1024 + 1)));
    expect(state.error()).toContain('smaller than 5 MB');
    await state.read(file('name,website\nInvalid,not a domain'));
    expect(state.error()).toBe('No rows have a domain like acme.com.');
    await state.read(file('name,stage\nAcme,Lead'));
    expect(state.error()).toContain('Include a Domain column');
    await state.run();
    expect(create).not.toHaveBeenCalled();
    expect(state.rows()).toEqual([]);
    dispose();
  });

  it('puts Stage and Owner on rows of a new pipeline, once', async () => {
    const created: Pipeline[] = [];
    const inserted: CellWrite[][] = [];
    let failInsert = true;
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
      {
        id: 'owner',
        name: 'Owner',
        dataType: 'ENTITY',
        specificEntityType: 'USER',
        isMultiSelect: false,
        options: [],
        writable: true,
      },
    ];
    const transfer: PipelineTransfer = {
      readTable: async () => ({
        columns,
        rows: inserted.map((cells) => ({
          cells: {
            company:
              cells[0]?.value.type === 'entities'
                ? cells[0].value.value[0].entityId
                : null,
          },
        })),
      }),
      describeRecords: async () => new Map(),
      resolveRecords: async (records) =>
        new Map(records.map((record) => [record.key, `${record.key}-id`])),
      insertRows: async (rows) => {
        if (failInsert) throw new Error('offline');
        inserted.push(...rows);
      },
      refresh: async () => {},
    };
    const create = vi.fn(async () => 'created' as const);
    const { state, dispose } = createRoot((dispose) => ({
      state: createCompanyImport(
        { create, refresh: async () => {} },
        {
          existing: () => [],
          create: async (name, sharing) => {
            const pipeline: Pipeline = {
              id: 'pipeline',
              teamId: 'team',
              name,
              userId: 'macro|owner@macro.com',
              recordType: 'company',
              databaseId: 'database',
              tableId: 'table',
              primaryColumnId: 'company',
              sharing,
              grant: 'owner',
              createdAt: '2026-10-16T00:00:00Z',
              trashedAt: null,
            };
            created.push(pipeline);
            return pipeline;
          },
          transfer: () => transfer,
        }
      ),
      dispose,
    }));
    await state.read(
      file(
        createCrmCsv(
          [
            { id: 'name', label: 'Company' },
            { id: 'domains', label: 'Domains' },
            { id: 'stage', label: 'Stage' },
            { id: 'owner', label: 'Owner' },
          ],
          [
            { name: 'Acme', domains: 'acme.com', stage: 'Churned', owner: '' },
            { name: 'Beta', domains: 'beta.io', stage: '', owner: '' },
            {
              name: 'Gamma',
              domains: 'gamma.dev',
              stage: '',
              owner: 'jane@macro.com',
            },
          ]
        ),
        'Macro Customers Oct 16 2026.csv'
      )
    );
    expect(state.pipelineData()?.fields).toEqual(['Stage', 'Owner']);
    expect(state.pipelineData()?.csv.rows).toHaveLength(2);
    await state.run();
    expect(state.completed()).toBe(3);
    expect(state.error()).toContain('Could not add Stage, Owner');
    expect(state.runnable()).toBe(true);
    failInsert = false;
    await state.run();
    expect(state.error()).toBe('');
    expect(create).toHaveBeenCalledTimes(3);
    expect(
      created.map((pipeline) => [pipeline.name, pipeline.sharing])
    ).toEqual([['Macro Customers Oct 16 2026', 'private']]);
    expect(state.pipeline()?.added).toBe(2);
    expect(inserted).toEqual([
      [
        {
          column: 'company',
          value: {
            type: 'entities',
            value: [{ entityType: 'COMPANY', entityId: 'acme.com-id' }],
          },
        },
        {
          column: 'stage',
          value: { type: 'options', value: [{ label: 'Churned' }] },
        },
      ],
      [
        {
          column: 'company',
          value: {
            type: 'entities',
            value: [{ entityType: 'COMPANY', entityId: 'gamma.dev-id' }],
          },
        },
        {
          column: 'owner',
          value: {
            type: 'entities',
            value: [{ entityType: 'USER', entityId: 'macro|jane@macro.com' }],
          },
        },
      ],
    ]);
    expect(state.runnable()).toBe(false);
    dispose();
  });

  it('imports companies without a pipeline when the file has no pipeline fields', async () => {
    const createPipeline = vi.fn();
    const { state, dispose } = createRoot((dispose) => ({
      state: createCompanyImport(
        { create: async () => 'created', refresh: async () => {} },
        { existing: () => [], create: createPipeline, transfer: vi.fn() }
      ),
      dispose,
    }));
    await state.read(file('Company,Domains,Stage\nAcme,acme.com,\n'));
    expect(state.pipelineData()).toBeUndefined();
    await state.run();
    expect(createPipeline).not.toHaveBeenCalled();
    expect(state.completed()).toBe(1);
    dispose();
  });

  it('fills an existing pipeline the viewer picks instead of making one', async () => {
    const deals: Pipeline = {
      id: 'deals',
      teamId: 'team',
      name: 'Deals',
      userId: 'macro|owner@macro.com',
      recordType: 'company',
      databaseId: 'database',
      tableId: 'table',
      primaryColumnId: 'company',
      sharing: 'team',
      grant: 'edit',
      createdAt: '2026-10-01T00:00:00Z',
      trashedAt: null,
    };
    const inserted: CellWrite[][] = [];
    const transferFor = vi.fn(
      (): PipelineTransfer => ({
        readTable: async () => ({
          columns: [
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
          ],
          rows: [],
        }),
        describeRecords: async () => new Map(),
        resolveRecords: async (records) =>
          new Map(records.map((record) => [record.key, `${record.key}-id`])),
        insertRows: async (rows) => {
          inserted.push(...rows);
        },
        refresh: async () => {},
      })
    );
    const createPipeline = vi.fn();
    const { state, dispose } = createRoot((dispose) => ({
      state: createCompanyImport(
        { create: async () => 'created', refresh: async () => {} },
        {
          existing: () => [deals],
          create: createPipeline,
          transfer: transferFor,
        }
      ),
      dispose,
    }));
    await state.read(file('Company,Domains,Stage\nAcme,acme.com,Lead\n'));
    state.setDestination({ kind: 'existing', id: 'deals' });
    await state.run();
    expect(createPipeline).not.toHaveBeenCalled();
    expect(transferFor).toHaveBeenCalledWith(deals);
    expect(state.pipeline()?.pipeline.id).toBe('deals');
    expect(inserted).toHaveLength(1);
    dispose();
  });
});
