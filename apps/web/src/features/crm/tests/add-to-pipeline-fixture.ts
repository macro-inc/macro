import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { Pipeline, TrackedPipeline } from '../core/pipeline';
import type { PipelineEntry } from '../core/pipeline-entry';
import type { StageRequirement } from '../core/stage-requirements';

/** A made-up pipeline of `recordType`, editable by the viewer unless `grant` says otherwise. */
export function fixturePipeline(
  id: string,
  name: string,
  recordType: Pipeline['recordType'],
  overrides: Partial<Pipeline> = {}
): Pipeline {
  return {
    id,
    teamId: 'team-fixture',
    name,
    userId: 'user-fixture',
    recordType,
    databaseId: `database-${id}`,
    tableId: `table-${id}`,
    primaryColumnId: 'record',
    sharing: 'team',
    grant: 'edit',
    createdAt: '2026-01-05T00:00:00Z',
    trashedAt: null,
    ...overrides,
  };
}

/** A pipeline's columns as the record page reads them: record, Stage, Outcome, Amount. */
export function fixtureColumns(
  recordType: TrackedPipeline['recordType']
): DatabaseViewColumn[] {
  return [
    {
      id: 'record',
      name: recordType === 'company' ? 'Company' : 'Contact',
      dataType: 'ENTITY',
      specificEntityType: recordType === 'company' ? 'COMPANY' : 'CONTACT',
      primary: true,
      isMultiSelect: false,
      writable: true,
      options: [],
    },
    {
      id: 'outcome',
      name: 'Outcome',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      writable: true,
      fixedOptions: true,
      nullable: false,
      defaultValue: 'Open',
      options: [
        { id: 'open', label: 'Open', color: null },
        { id: 'won', label: 'Won', color: null },
        { id: 'lost', label: 'Lost', color: null },
      ],
    },
    {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      writable: true,
      options: [
        { id: 'lead', label: 'Lead', color: null },
        { id: 'qualified', label: 'Qualified', color: null },
        { id: 'proposal', label: 'Proposal', color: null },
      ],
    },
    {
      id: 'amount',
      name: 'Amount',
      dataType: 'NUMBER',
      isMultiSelect: false,
      writable: true,
      options: [],
    },
  ];
}

/** Proposal requires an amount. */
export const FIXTURE_REQUIREMENTS: StageRequirement[] = [
  { columnId: 'stage', optionId: 'proposal', fields: ['amount'] },
];

/** The record's row in `pipeline`, at `stage`. */
export function fixtureEntry(
  pipeline: Pipeline,
  rowId: string,
  stage: string,
  amount: number | null = null
): PipelineEntry {
  const columns = fixtureColumns(pipeline.recordType ?? 'company').filter(
    (column) => column.id !== 'record'
  );
  const values: Record<string, string | number | null> = {
    outcome: 'Open',
    stage,
    amount,
  };
  return {
    rowId,
    pipeline: {
      id: pipeline.id,
      name: pipeline.name,
      tableId: pipeline.tableId,
      shared: pipeline.sharing === 'team',
      canEdit: pipeline.grant === 'edit' || pipeline.grant === 'owner',
    },
    cells: columns.map((column) => ({
      column,
      value: values[column.id] ?? null,
    })),
  };
}
