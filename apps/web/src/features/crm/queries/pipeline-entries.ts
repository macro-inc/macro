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
import type { DatabaseApi } from '../../database/core/api';
import { toCellRange } from '../../database/core/cell-date-range';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import { UNAVAILABLE_OPTION } from '../../database/core/grid-cells';
import { writeDatabaseRow } from '../../database/core/row-write';
import type { TrackedPipeline } from '../core/pipeline';
import type {
  PipelineEntry,
  PipelineEntryCell,
  PipelineEntryRecord,
} from '../core/pipeline-entry';
import type { CrmRecordDependencies } from './dependencies';
import { trackPipelineEntryWrites } from './pipeline-data';

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
    .exhaustive(() => '');
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
    currencyColumnId: column.currencyColumnId ?? undefined,
    fixedOptions: column.systemDefault != null,
    nullable: column.systemDefault == null ? undefined : false,
    defaultValue: column.systemDefault ?? undefined,
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
    .with(
      { __typename: 'GraphqlDateRangePropertyValue' },
      ({ rangeStart, rangeEnd }) =>
        toCellRange({ start: rangeStart, end: rangeEnd })
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
    .exhaustive(() => null);
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

/**
 * The viewer's pipeline rows that reference one company or contact. The
 * Pipelines card reads `cache-and-network`; a later reader of the same record
 * can pass `cache-first` to take the card's answer from the cache instead of
 * sending the request again.
 */
export function createPipelineEntriesQuery(
  graphql: PipelineEntriesDependencies['graphql'],
  record: Accessor<PipelineEntryRecord | undefined>,
  requestPolicy: 'cache-and-network' | 'cache-first' = 'cache-and-network'
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
      requestPolicy,
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
    /** No answer yet, so `entries` cannot say the record is in no pipeline. */
    pending: () => query.isPending,
    failed: () => !query.isSuccess && query.isError,
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}

/** A pipeline's ops, written from a record's page. */
function recordPageOps(
  storage: PipelineEntriesDependencies['storage'],
  pipelineId: string,
  /** Whose record page the write is made from. */
  recordType: PipelineEntryRecord['type']
): DatabaseApi['applyOps'] {
  return (batch) =>
    storage
      .applyCrmPipelineOps(pipelineId, batch)
      .mapErr(([error]) => error)
      .map((applied) => {
        trackPipelineEntryWrites(
          { id: pipelineId, recordType },
          'record',
          batch.ops
        );
        return applied;
      });
}

/** One cell of an entry, written through its pipeline's ops. */
export function savePipelineEntryCell(
  storage: PipelineEntriesDependencies['storage'],
  entry: PipelineEntry,
  /** Whose record page the entry is edited from. */
  recordType: PipelineEntryRecord['type'],
  cell: PipelineEntryCell,
  value: DatabaseCellValue,
  createOptions: boolean
) {
  return writeDatabaseRow(
    {
      tableId: entry.pipeline.tableId,
      columns: entry.cells.map((current) => current.column),
      applyOps: recordPageOps(storage, entry.pipeline.id, recordType),
    },
    { kind: 'cell', rowId: entry.rowId, columnId: cell.column.id, value },
    createOptions
  );
}

/**
 * A new row for the record, written through its pipeline's ops: the same
 * row write the pipeline's own table makes when a deal or contact is added.
 */
export function addPipelineEntryRow(
  storage: PipelineEntriesDependencies['storage'],
  pipeline: TrackedPipeline,
  columns: readonly DatabaseViewColumn[],
  values: Record<string, DatabaseCellValue>,
  createOptions: boolean
) {
  return writeDatabaseRow(
    {
      tableId: pipeline.tableId,
      columns,
      applyOps: recordPageOps(storage, pipeline.id, pipeline.recordType),
    },
    { kind: 'create', values },
    createOptions
  );
}
