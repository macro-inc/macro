import { thrownResultErrorHasCode } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { downloadExportedDocument } from '@service-storage/util/downloadExportedDocument';
import { syncServiceClient } from '@service-sync/client';
import { createSyncServiceSource } from '@service-sync/source';
import type { DocumentSyncAuthorization } from '@service-sync/source/authorization';
import { buildSeedSnapshot } from '../core/docx-seed';
import { docxOriginalQueryOptions } from './docx-original';
import type { DocxConnection } from './docx-session';

/**
 * The DOCX as uploaded, rebuilt by document storage from its stored parts.
 * Cached so views opening the same file share one download.
 */
export function fetchOriginalDocx(documentId: string): Promise<Uint8Array> {
  return Telemetry.span('docx.original.wait', async (span) => {
    span.setAttr('document.id', documentId);
    let attempts = 0;
    try {
      const original = await queryClient.fetchQuery(
        docxOriginalQueryOptions(documentId, () => {
          attempts++;
          return span.run(() => downloadExportedDocument({ documentId }));
        })
      );
      span.setAttr('docx.export.outcome', 'ready');
      return original;
    } catch (error) {
      span.setAttr(
        'docx.export.outcome',
        thrownResultErrorHasCode(error, 'CONFLICT')
          ? 'processing_timeout'
          : 'failed'
      );
      span.error(error);
      throw error;
    } finally {
      span.setAttr('docx.export.retry_count', Math.max(0, attempts - 1));
    }
  });
}

export async function docxSyncExists(documentId: string): Promise<boolean> {
  const result = await syncServiceClient.exists({ documentId });
  if (result.isErr()) throw new Error('Unable to reach the sync service.');
  return result.value.exists;
}

export async function initializeDocxSync(
  documentId: string,
  snapshot: Uint8Array
): Promise<void> {
  const result = await syncServiceClient.initializeFromSnapshot({
    documentId,
    snapshot,
  });
  if (result.isErr()) throw new Error('Unable to initialize collaboration.');
}

export function buildDocxSeed(original: Uint8Array): Promise<Uint8Array> {
  return buildSeedSnapshot(original);
}

export function connectDocxSync(
  documentId: string,
  token: string | undefined,
  authorization?: DocumentSyncAuthorization
): DocxConnection {
  return createSyncServiceSource(documentId, token, authorization);
}
