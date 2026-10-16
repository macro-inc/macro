import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import {
  type CrmPipelineEntryFieldsFragment,
  CrmRecordPipelineEntriesDocument,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import { UNAVAILABLE_OPTION } from '../../database/core/grid-cells';
import { writeDatabaseRow } from '../../database/core/row-write';
import type {
  PipelineEntry,
  PipelineEntryCell,
  PipelineEntryRecord,
} from '../core/pipeline-entry';
import type { CrmRecordDependencies } from './dependencies';

/** What the record's pipeline cards read and write through. */
export type PipelineEntriesDependencies = {
  graphql: () => Client;
  storage: Pick<CrmRecordDependencies['storage'], 'applyCrmPipelineOps'>;
};

type GraphqlCell = CrmPipelineEntryFieldsFragment['cells'][number];

function optionLabel(option: GraphqlCell['column']['options'][number]): string {
  return match(option.value)
    .with({ __typename: 'GraphqlStringPropertyOptionValue' }, (value) =>
      String(value.stringValue)
    )
    .with({ __typename: 'GraphqlNumberPropertyOptionValue' }, (value) =>
      String(value.numberValue)
    )
    .exhaustive();
}

function entryColumn(column: GraphqlCell['column']): DatabaseViewColumn {
  return {
    id: column.id,
    name: column.name,
    dataType: column.dataType,
    isMultiSelect: column.isMultiSelect,
    options: column.options.map((option) => ({
      id: option.id,
      label: optionLabel(option),
      color: option.color,
    })),
    writable: column.writable,
    specificEntityType: column.specificEntityType,
  };
}

/** A stored value in the grid's terms, as the pipeline table reads it. */
export function entryCellValue(cell: GraphqlCell): DatabaseCellValue {
  const value = cell.value;
  if (!value) return null;
  const listed = (values: string[]) =>
    cell.column.isMultiSelect ? JSON.stringify(values) : (values[0] ?? null);
  return match(value)
    .with({ __typename: 'GraphqlBooleanPropertyValue' }, ({ boolValue }) =>
      boolValue ? 1 : 0
    )
    .with(
      { __typename: 'GraphqlNumberPropertyValue' },
      ({ numberValue }) => numberValue
    )
    .with(
      { __typename: 'GraphqlStringPropertyValue' },
      ({ stringValue }) => stringValue
    )
    .with({ __typename: 'GraphqlDatePropertyValue' }, ({ dateValue }) =>
      String(dateValue)
    )
    .with({ __typename: 'GraphqlLinkPropertyValue' }, ({ urls }) =>
      listed(urls)
    )
    .with(
      { __typename: 'GraphqlEntityReferencePropertyValue' },
      ({ references }) => listed(references.map((ref) => ref.entityId))
    )
    .with({ __typename: 'GraphqlSelectOptionPropertyValue' }, ({ optionIds }) =>
      listed(
        optionIds.map((id) => {
          const option = cell.column.options.find((option) => option.id === id);
          return option ? optionLabel(option) : UNAVAILABLE_OPTION;
        })
      )
    )
    .exhaustive();
}

export function toPipelineEntry(
  entry: CrmPipelineEntryFieldsFragment
): PipelineEntry {
  return {
    rowId: entry.id,
    pipeline: {
      id: entry.pipeline.id,
      name: entry.pipeline.name,
      tableId: entry.pipeline.tableId,
      shared: entry.pipeline.sharing === 'TEAM',
      canEdit: entry.pipeline.canEdit,
    },
    cells: entry.cells.map((cell) => ({
      column: entryColumn(cell.column),
      value: entryCellValue(cell),
    })),
  };
}

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/** A one-record soup query for a company or a contact. */
export function pipelineEntriesInput(
  record: PipelineEntryRecord
): SoupInput | undefined {
  if (record.type === 'company')
    return buildGraphqlEntitySoupInput('COMPANY', record.id);
  // Contacts join soup only through their opt-in filter, so start from a query that excludes every other item.
  const input = buildGraphqlEntitySoupInput('COMPANY', NIL_ENTITY_ID);
  if (!input?.initial) return undefined;
  return {
    initial: {
      ...input.initial,
      filters: {
        ...input.initial.filters,
        crmContactFilter: { literal: { id: record.id } },
      },
    },
  };
}

/** The viewer's pipeline rows that reference one company or contact. */
export function createPipelineEntriesQuery(
  graphql: PipelineEntriesDependencies['graphql'],
  record: Accessor<PipelineEntryRecord | undefined>
) {
  const client = createMemo(graphql);
  const query = createLiveQuery(
    CrmRecordPipelineEntriesDocument,
    () => {
      const current = record();
      const input = current && pipelineEntriesInput(current);
      return input ? { input } : undefined;
    },
    () => ({
      client: client(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: (data) =>
        data.user.soup.items.flatMap((item) =>
          item.__typename === 'GraphqlSoupCrmCompany' ||
          item.__typename === 'GraphqlSoupCrmContact'
            ? item.pipelineEntries.map(toPipelineEntry)
            : []
        ),
    })
  );
  return {
    entries: (): PipelineEntry[] => (query.isSuccess ? (query.data ?? []) : []),
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}

/** One cell of an entry, written through its pipeline's ops. */
export function savePipelineEntryCell(
  storage: PipelineEntriesDependencies['storage'],
  entry: PipelineEntry,
  cell: PipelineEntryCell,
  value: DatabaseCellValue,
  createOptions: boolean
) {
  return writeDatabaseRow(
    {
      tableId: entry.pipeline.tableId,
      columns: entry.cells.map((current) => current.column),
      applyOps: (batch) =>
        storage
          .applyCrmPipelineOps(entry.pipeline.id, batch)
          .mapErr(([error]) => error),
    },
    { kind: 'cell', rowId: entry.rowId, columnId: cell.column.id, value },
    createOptions
  );
}
