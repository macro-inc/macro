import { describe, expect, it } from 'vitest';
import { parseDatabaseCsv } from '../../database/core/csv';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { encodePipelineCsv, planPipelineImport } from './pipeline-csv';

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
  {
    id: 'revenue',
    name: 'Revenue',
    dataType: 'NUMBER',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'close',
    name: 'Close date',
    dataType: 'DATE',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'tags',
    name: 'Tags',
    dataType: 'TAG',
    isMultiSelect: true,
    options: [],
    writable: true,
  },
  {
    id: 'doc',
    name: 'Proposal',
    dataType: 'ENTITY',
    specificEntityType: 'DOCUMENT',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
];
const pipeline = {
  recordType: 'company' as const,
  columns,
  primaryColumnId: 'company',
};

describe('pipeline CSV', () => {
  it('imports what it exports', () => {
    const csv = encodePipelineCsv({
      ...pipeline,
      rows: [
        {
          cells: {
            company: 'acme-id',
            stage: 'Lead',
            owner: 'macro|jane@macro.com',
            revenue: 1250.5,
            close: '2026-11-01T00:00:00Z',
            tags: '["Enterprise","Inbound"]',
            doc: 'doc-id',
          },
        },
        { cells: { company: 'missing-id', stage: null } },
      ],
      record: (id) =>
        id === 'acme-id' ? { name: ' =Acme', key: 'acme.com' } : undefined,
    });
    expect(csv.split('\n')[0]).toBe(
      'Company,Domain,Stage,Owner,Revenue,Close date,Tags,Proposal'
    );
    const plan = planPipelineImport(
      parseDatabaseCsv(csv)._unsafeUnwrap(),
      pipeline
    )._unsafeUnwrap();
    expect(plan.rows).toEqual([
      {
        record: { name: '=Acme', key: 'acme.com' },
        cells: [
          {
            column: 'stage',
            value: { type: 'options', value: [{ label: 'Lead' }] },
          },
          {
            column: 'owner',
            value: {
              type: 'entities',
              value: [{ entityType: 'USER', entityId: 'macro|jane@macro.com' }],
            },
          },
          { column: 'revenue', value: { type: 'number', value: 1250.5 } },
          {
            column: 'close',
            value: { type: 'date', value: '2026-11-01T00:00:00.000Z' },
          },
          {
            column: 'tags',
            value: {
              type: 'options',
              value: [{ label: 'Enterprise' }, { label: 'Inbound' }],
            },
          },
        ],
      },
    ]);
    expect(plan.skipped).toBe(1);
    expect(plan.columns).toEqual([
      'Stage',
      'Owner',
      'Revenue',
      'Close date',
      'Tags',
    ]);
    expect(plan.ignored).toEqual(['Proposal']);
  });

  it('leaves out values that do not fit their column instead of the row', () => {
    const plan = planPipelineImport(
      parseDatabaseCsv(
        'name,website,revenue,owner,close date,notes\n' +
          'Acme,https://www.acme.com/about,lots,not-an-email,someday,hi\n' +
          ',beta.io,10,,,\n'
      )._unsafeUnwrap(),
      pipeline
    )._unsafeUnwrap();
    expect(plan.rows).toEqual([
      { record: { name: 'Acme', key: 'acme.com' }, cells: [] },
      {
        record: { name: 'beta.io', key: 'beta.io' },
        cells: [{ column: 'revenue', value: { type: 'number', value: 10 } }],
      },
    ]);
    expect(plan.invalidCells).toBe(3);
    expect(plan.ignored).toEqual(['notes']);
  });

  it('needs the column that names each record', () => {
    const csv = parseDatabaseCsv('Company,Stage\nAcme,Lead')._unsafeUnwrap();
    expect(planPipelineImport(csv, pipeline)._unsafeUnwrapErr()).toEqual({
      kind: 'no-record-column',
      recordType: 'company',
    });
    const contacts = planPipelineImport(
      parseDatabaseCsv('Contact,Email\nJane,JANE@acme.com')._unsafeUnwrap(),
      { ...pipeline, recordType: 'contact', primaryColumnId: 'contact' }
    )._unsafeUnwrap();
    expect(contacts.rows[0].record).toEqual({
      name: 'Jane',
      key: 'jane@acme.com',
    });
  });
});

it('round-trips a monetary amount with its currency and refuses unknown denominations', () => {
  const moneyColumns: DatabaseViewColumn[] = [
    ...columns,
    {
      id: 'period',
      name: 'Contract period',
      dataType: 'DATE_RANGE',
      isMultiSelect: false,
      writable: true,
      options: [],
    },
    {
      id: 'currency',
      name: 'Revenue currency',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      writable: true,
      fixedOptions: true,
      defaultValue: 'USD',
      options: [
        { id: 'eur', label: 'EUR', color: null },
        { id: 'usd', label: 'USD', color: null },
      ],
    },
  ];
  const csv = encodePipelineCsv({
    ...pipeline,
    columns: moneyColumns,
    rows: [
      {
        cells: {
          company: 'acme',
          revenue: 1234.567,
          currency: 'EUR',
          period: '2026-11-01T00:00:00Z/2026-11-30T00:00:00Z',
        },
      },
    ],
    record: () => ({ name: 'Acme', key: 'acme.com' }),
  });
  const imported = planPipelineImport(parseDatabaseCsv(csv)._unsafeUnwrap(), {
    ...pipeline,
    columns: moneyColumns,
  })._unsafeUnwrap();
  expect(imported.rows[0].cells).toContainEqual({
    column: 'revenue',
    value: { type: 'number', value: 1234.567 },
  });
  expect(imported.rows[0].cells).toContainEqual({
    column: 'currency',
    value: { type: 'options', value: [{ label: 'EUR' }] },
  });
  expect(imported.rows[0].cells).toContainEqual({
    column: 'period',
    value: {
      type: 'date_range',
      value: {
        start: '2026-11-01T00:00:00.000Z',
        end: '2026-11-30T00:00:00.000Z',
      },
    },
  });
  const invalid = parseDatabaseCsv(
    'Company,Domain,Revenue,Revenue currency,Contract period\nAcme,acme.com,100,ZZZ,\nGlobex,globex.com,200,USD,later/earlier'
  )._unsafeUnwrap();
  const planned = planPipelineImport(invalid, {
    ...pipeline,
    columns: moneyColumns,
  })._unsafeUnwrap();
  expect(planned.invalidSystemRows).toBe(1);
  expect(planned.invalidCells).toBe(1);
  expect(planned.skipped).toBe(0);
  expect(planned.rows.map((row) => row.record.key)).toEqual(['globex.com']);
  expect(planned.rows[0].cells).toEqual([
    { column: 'revenue', value: { type: 'number', value: 200 } },
    {
      column: 'currency',
      value: { type: 'options', value: [{ label: 'USD' }] },
    },
  ]);
  expect(
    planPipelineImport(
      { ...invalid, rows: invalid.rows.slice(0, 1) },
      {
        ...pipeline,
        columns: moneyColumns,
      }
    )._unsafeUnwrapErr()
  ).toEqual({ kind: 'invalid-system-values' });
});
