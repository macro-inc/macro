import type { Accessor, Component, JSX } from 'solid-js';
import type { NewPipeline, Pipeline } from '../core/pipeline';
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
