import type { IDocumentStorageServiceFile } from '@filesystem/file';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';

export type MarkdownDocumentKind = 'document' | 'task' | 'snippet' | 'skill';

export type MarkdownDocumentSource =
  | { type: 'loading' }
  | { type: 'dss'; file: IDocumentStorageServiceFile }
  | { type: 'sync'; source: LiveSyncSource }
  | { type: 'session'; context: SyncDocumentOpenContext };
