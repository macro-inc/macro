import { RUST_EDITOR_ENGINE } from '@core/document-session/engine-selection';
import type { Span } from '@macro-inc/observability';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
import { createSyncServiceSource } from '@service-sync/source';

export type MarkdownConnection =
  | ({ type: 'sync' } & ReturnType<typeof createSyncServiceSource>)
  | { type: 'session'; context: SyncDocumentOpenContext };

/**
 * Select one model owner before constructing any legacy socket or manager.
 * Uses the boot engine choice; a later rollout value applies on the next load.
 */
export function createMarkdownConnection(
  documentId: string,
  context: SyncDocumentOpenContext,
  parentSpan: Span
): MarkdownConnection {
  if (RUST_EDITOR_ENGINE) return { type: 'session', context };
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
