import type { CellWrite } from '@core/database-sql/generated/types';
import type { Accessor, Component, JSX } from 'solid-js';
import type { GridCellProps } from '../../database/components/grid-cell';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { RecordCreation } from '../../database/primitives/record-actions';
import type { NewPipeline, Pipeline, TrackedPipeline } from '../core/pipeline';
import type { PipelineCsvRecord, PipelineCsvRow } from '../core/pipeline-csv';
import type {
  PipelineEntry,
  PipelineEntryRecord,
} from '../core/pipeline-entry';
import type { StageRequirement } from '../core/stage-requirements';

export type PipelinesSource = {
  pipelines: Accessor<Pipeline[]>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  refresh(): Promise<void>;
  create(input: NewPipeline): Promise<Pipeline>;
  rename(id: string, name: string): Promise<void>;
  trash(id: string): Promise<void>;
};

/** Reads and writes one pipeline's entries in bulk, for CSV import and export. */
export type PipelineTransfer = {
  /** The pipeline's columns and every one of its rows. */
  readTable(signal: AbortSignal): Promise<{
    columns: DatabaseViewColumn[];
    rows: PipelineCsvRow[];
  }>;
  /** The name and domain or email of each record the ids name. */
  describeRecords(
    ids: readonly string[],
    signal: AbortSignal
  ): Promise<Map<string, PipelineCsvRecord>>;
  /**
   * Record ids by domain or email, creating the companies and contacts the
   * team lacks. A record that cannot be found or created is left out.
   */
  resolveRecords(
    records: readonly PipelineCsvRecord[],
    signal: AbortSignal,
    progress: (count: number) => void
  ): Promise<Map<string, string>>;
  /** Appends rows, first adding the select options they name that columns lack. */
  insertRows(
    rows: readonly CellWrite[][],
    columns: readonly DatabaseViewColumn[],
    onRejected?: (row: number, reason: string) => void
  ): Promise<void>;
  /** Shows the new rows and records everywhere they appear. */
  refresh(): Promise<void>;
};

/** Where a company import puts Stage, Owner, and Revenue: a new company pipeline. */
export type CompanyImportPipelines = {
  /** Company pipelines the viewer can edit, which the import can fill instead. */
  existing: Accessor<Pipeline[]>;
  create(name: string, sharing: Pipeline['sharing']): Promise<Pipeline>;
  transfer(pipeline: Pipeline): PipelineTransfer;
};

export type PipelineEditor = Component<{
  pipeline: Pipeline;
  /** Compact host actions placed alongside the editor's record controls. */
  actions?: JSX.Element;
  /** Show the company or contact a row is for. */
  onOpenRecord?(record: { type: 'company' | 'contact'; id: string }): void;
}>;

export type PipelineSharing = Component<{
  pipeline: Pipeline;
  onCopyLink(): void;
}>;

/** The pipeline rows that reference a company or contact, as editable cards. */
export type PipelineEntriesView = Component<{
  record: PipelineEntryRecord;
  onOpenPipeline?: (pipelineId: string) => void;
}>;

/** The record a page offers to add to a pipeline, as the add form names it. */
export type AddToPipelineRecord = PipelineEntryRecord & {
  name: string;
  /** Its domain or email, shown beside the name. */
  detail: string;
};

/** One pipeline's columns and stage requirements, read while its stages or add form are shown. */
export type PipelineSchemaSource = {
  /** Undefined until read. */
  columns: Accessor<DatabaseViewColumn[] | undefined>;
  /** Undefined until read. */
  requirements: Accessor<StageRequirement[] | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
};

/** How a pipeline row added from a record's page ended. */
export type PipelineRowAdded =
  | { kind: 'added' }
  /** The answer was lost; the row may have been saved. */
  | { kind: 'uncertain' }
  | { kind: 'failed'; message: string };

/**
 * What a record page's Add to pipeline menu reads and writes. Created when the
 * menu first opens, so a page that never opens it reads nothing.
 */
export type AddToPipelineSource = {
  /** The team's pipelines the viewer can see. */
  pipelines: Accessor<Pipeline[]>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  retry(): Promise<void>;
  /** The record's pipeline rows, as its Pipelines card reads them. */
  entries: Accessor<PipelineEntry[]>;
  createSchema(pipeline: TrackedPipeline): PipelineSchemaSource;
  /** Writes one row, then rereads the record's rows so its Pipelines card shows it. */
  addRow(
    pipeline: TrackedPipeline,
    columns: readonly DatabaseViewColumn[],
    creation: RecordCreation
  ): Promise<PipelineRowAdded>;
  /** How the add form shows and edits text, links and mentions. */
  cells: PipelineCellRenderers;
};

export type PipelineCellRenderers = Pick<
  GridCellProps,
  | 'renderTextEditor'
  | 'renderTextValue'
  | 'renderLinkValue'
  | 'renderMentionPicker'
  | 'renderMentionValue'
>;
