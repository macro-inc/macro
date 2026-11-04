import type { CrmPipelineEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { okAsync } from 'neverthrow';
import { expect, it, vi } from 'vitest';
import { UNAVAILABLE_OPTION } from '../../database/core/grid-cells';
import {
  type PipelineEntriesDependencies,
  pipelineEntriesInput,
  savePipelineEntryCell,
  toPipelineEntry,
} from './pipeline-entries';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

type Cell = CrmPipelineEntryFieldsFragment['cells'][number];
type Column = Cell['column'];

function column(overrides: Partial<Column>): Column {
  return {
    __typename: 'GraphqlCrmPipelineColumn',
    id: 'column',
    name: 'Column',
    dataType: 'STRING',
    isMultiSelect: false,
    specificEntityType: null,
    writable: true,
    options: [],
    ...overrides,
  };
}

const stageOptions: Column['options'] = [
  {
    __typename: 'GraphqlPropertyOption',
    id: 'lead',
    color: 'blue',
    value: {
      __typename: 'GraphqlStringPropertyOptionValue',
      stringValue: 'Lead',
    },
  },
  {
    __typename: 'GraphqlPropertyOption',
    id: 'tier',
    color: null,
    value: { __typename: 'GraphqlNumberPropertyOptionValue', numberValue: 2 },
  },
];

function entry(cells: Cell[]): CrmPipelineEntryFieldsFragment {
  return {
    __typename: 'GraphqlCrmPipelineEntry',
    id: 'row',
    pipeline: {
      __typename: 'GraphqlCrmPipeline',
      id: 'pipeline',
      name: 'Sales',
      sharing: 'PRIVATE',
      tableId: 'table',
      canEdit: false,
    },
    cells,
  };
}

it('reads stored values the way the pipeline table does', () => {
  const mapped = toPipelineEntry(
    entry([
      {
        __typename: 'GraphqlCrmPipelineCell',
        column: column({
          id: 'stage',
          dataType: 'SELECT_STRING',
          options: stageOptions,
        }),
        value: {
          __typename: 'GraphqlSelectOptionPropertyValue',
          optionIds: ['lead'],
        },
      },
      {
        __typename: 'GraphqlCrmPipelineCell',
        column: column({
          id: 'tags',
          dataType: 'SELECT_NUMBER',
          isMultiSelect: true,
          options: stageOptions,
        }),
        value: {
          __typename: 'GraphqlSelectOptionPropertyValue',
          optionIds: ['tier', 'gone'],
        },
      },
      {
        __typename: 'GraphqlCrmPipelineCell',
        column: column({
          id: 'owner',
          dataType: 'ENTITY',
          specificEntityType: 'USER',
        }),
        value: {
          __typename: 'GraphqlEntityReferencePropertyValue',
          references: [
            {
              entityId: 'macro|alice',
              entityType: 'USER',
              specificMessageId: null,
            },
          ],
        },
      },
      {
        __typename: 'GraphqlCrmPipelineCell',
        column: column({ id: 'won', dataType: 'BOOLEAN' }),
        value: { __typename: 'GraphqlBooleanPropertyValue', boolValue: true },
      },
      {
        __typename: 'GraphqlCrmPipelineCell',
        column: column({ id: 'notes' }),
        value: null,
      },
    ])
  );
  expect(mapped.pipeline).toEqual({
    id: 'pipeline',
    name: 'Sales',
    tableId: 'table',
    shared: false,
    canEdit: false,
  });
  expect(mapped.cells.map((cell) => [cell.column.id, cell.value])).toEqual([
    ['stage', 'Lead'],
    ['tags', JSON.stringify(['2', UNAVAILABLE_OPTION])],
    ['owner', 'macro|alice'],
    ['won', 1],
    ['notes', null],
  ]);
  expect(mapped.cells[0].column.options).toEqual([
    { id: 'lead', label: 'Lead', color: 'blue' },
    { id: 'tier', label: '2', color: null },
  ]);
});

it('reads value kinds from a newer server as empty instead of throwing', () => {
  const fromNewerServer = JSON.parse(
    '{"__typename":"GraphqlColorPropertyValue","hex":"#ff0000"}'
  );
  const optionFromNewerServer = JSON.parse(
    '{"__typename":"GraphqlColorPropertyOptionValue","hex":"#ff0000"}'
  );
  const mapped = toPipelineEntry(
    entry([
      {
        __typename: 'GraphqlCrmPipelineCell',
        column: column({
          id: 'shade',
          options: [
            {
              __typename: 'GraphqlPropertyOption',
              id: 'red',
              color: null,
              value: optionFromNewerServer,
            },
          ],
        }),
        value: fromNewerServer,
      },
    ])
  );
  expect(mapped.cells[0].value).toBeNull();
  expect(mapped.cells[0].column.options).toEqual([
    { id: 'red', label: '', color: null },
  ]);
});

it('reads one company or one contact through soup', () => {
  const company = pipelineEntriesInput({ type: 'company', id: 'acme' });
  expect(company?.initial?.filters?.crmCompanyFilter).toEqual({
    literal: { id: 'acme' },
  });
  expect(company?.initial?.filters?.crmContactFilter).toBeUndefined();

  const contact = pipelineEntriesInput({ type: 'contact', id: 'maya' });
  const filters = contact?.initial?.filters;
  expect(filters?.crmContactFilter).toEqual({ literal: { id: 'maya' } });
  // Every other branch matches nothing, so the contact is the only item.
  expect(filters?.crmCompanyFilter).toEqual({
    literal: { id: '00000000-0000-0000-0000-000000000000' },
  });
  expect(filters?.documentFilter).toEqual(
    company?.initial?.filters?.documentFilter
  );
  expect(contact?.initial?.limit).toBe(1);
});

it('reports a record page pipeline write with the record type', async () => {
  const mapped = toPipelineEntry(
    entry([
      {
        __typename: 'GraphqlCrmPipelineCell',
        column: column({ id: 'notes' }),
        value: null,
      },
    ])
  );
  const storage = {
    applyCrmPipelineOps: vi.fn(() => okAsync({ results: [], changes: [] })),
  } as unknown as PipelineEntriesDependencies['storage'];

  await savePipelineEntryCell(
    storage,
    mapped,
    'contact',
    mapped.cells[0],
    'Follow up',
    false
  );

  expect(track).toHaveBeenCalledExactlyOnceWith('crm_pipeline_entries_edited', {
    pipelineId: 'pipeline',
    recordType: 'contact',
    surface: 'record',
    insertedRows: 0,
    updatedRows: 1,
    deletedRows: 0,
  });
});
