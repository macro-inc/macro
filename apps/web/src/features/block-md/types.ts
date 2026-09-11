import type { IDocumentStorageServiceFile } from '@filesystem/file';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';

export interface Diff {
  operation: string;
  node_key: string;
  markdown_text: string;
}

export type MarkdownDocumentKind = 'document' | 'task' | 'snippet' | 'skill';

export type MarkdownDocumentSource =
  | { type: 'loading' }
  | { type: 'dss'; file: IDocumentStorageServiceFile }
  | { type: 'sync'; source: LiveSyncSource };
