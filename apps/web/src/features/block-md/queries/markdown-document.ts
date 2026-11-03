import { throwOnErr } from '@core/util/result';
import { NOOP_SPAN, type Span } from '@macro-inc/observability';
import { fetchSyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { createSyncServiceSource } from '@service-sync/source';
import { match } from 'ts-pattern';

export type MarkdownDocumentData = ReturnType<
  typeof createSyncServiceSource
> & {
  metadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  permissions: {
    canComment: boolean;
    canEdit: boolean;
    isOwner: boolean;
  };
};

export async function loadMarkdownDocument(
  documentId: string,
  parentSpan: Span = NOOP_SPAN
): Promise<MarkdownDocumentData> {
  return parentSpan.span('doc.load', async (loadSpan) => {
    const context = await loadSpan.span('doc.load.context', () =>
      throwOnErr(() => fetchSyncDocumentOpenContext(documentId))
    );
    const { documentMetadata, token, authorization, userAccessLevel } = context;
    loadSpan.setAttr('doc.context.cached', context.fromCache);
    const permissions = match(userAccessLevel)
      .with('owner', () => ({
        canComment: true,
        canEdit: true,
        isOwner: true,
      }))
      .with('edit', () => ({
        canComment: true,
        canEdit: true,
        isOwner: false,
      }))
      .with('comment', () => ({
        canComment: true,
        canEdit: false,
        isOwner: false,
      }))
      .with('view', () => ({
        canComment: false,
        canEdit: false,
        isOwner: false,
      }))
      .exhaustive(() => ({
        canComment: false,
        canEdit: false,
        isOwner: false,
      }));

    return {
      ...createSyncServiceSource(documentId, token, authorization, parentSpan),
      metadata: documentMetadata,
      userAccessLevel,
      permissions,
    };
  });
}
