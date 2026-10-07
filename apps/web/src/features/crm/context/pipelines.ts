import type { Accessor, Component } from 'solid-js';
import type { NewPipeline, Pipeline } from '../core/pipeline';

export type PipelinesSource = {
  pipelines: Accessor<Pipeline[]>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  refresh(): Promise<void>;
  create(input: NewPipeline): Promise<Pipeline>;
  rename(id: string, name: string): Promise<void>;
  trash(id: string): Promise<void>;
};

export type PipelineEditor = Component<{ pipeline: Pipeline }>;

export type PipelineSharing = Component<{
  pipeline: Pipeline;
  onCopyLink(): void;
}>;
