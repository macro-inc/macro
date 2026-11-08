import type { Span } from '@macro-inc/observability';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
import { createSyncServiceSource } from '@service-sync/source';

export type MarkdownConnection =
  | ({ type: 'sync' } & ReturnType<typeof createSyncServiceSource>)
  | { type: 'session'; context: SyncDocumentOpenContext };

/** Select one model owner before constructing any legacy socket or manager. */
export async function createMarkdownConnection(
  documentId: string,
  context: SyncDocumentOpenContext,
  parentSpan: Span,
  enabled: boolean
): Promise<MarkdownConnection> {
  if (enabled) return { type: 'session', context };
  return {
    type: 'sync',
    ...createSyncServiceSource(
      documentId,
      context.token,
      context.authorization,
      parentSpan
    ),
  };
}
