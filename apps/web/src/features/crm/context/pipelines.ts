import type { CellWrite } from '@core/database-sql/generated/types';
import type { Accessor, Component, JSX } from 'solid-js';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { NewPipeline, Pipeline } from '../core/pipeline';
import type { PipelineCsvRecord, PipelineCsvRow } from '../core/pipeline-csv';
import type { PipelineEntryRecord } from '../core/pipeline-entry';

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
    columns: readonly DatabaseViewColumn[]
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
