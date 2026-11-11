import { ThrownResultError, throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { waitForDocumentContentReady } from '@queries/storage/document-location';
import { fetchFileDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { fetchBinary } from '@service-storage/util/fetchBinary';

export type CanvasDocumentData = {
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
} & ({ shared: true; file?: never } | { shared: false; file: Blob });

/** Resolve authorization and content location before loading a legacy seed. */
export async function loadCanvasDocument(
  documentId: string,
  parentSpan?: Span
): Promise<CanvasDocumentData> {
  return (parentSpan ?? Telemetry).span('canvas.load', async (span) => {
    const context = await span.span('canvas.context', () =>
      throwOnErr(() => fetchFileDocumentOpenContext(documentId))
    );
    const data = {
      documentMetadata: context.documentMetadata,
      userAccessLevel: context.userAccessLevel,
    };
    const location = await span.span('canvas.location', () =>
      waitForDocumentContentReady({ documentId })
    );
    if (location.content.state === 'ready') {
      if (location.type === 'syncServiceContent')
        return { ...data, shared: true };
      if (location.type === 'presignedUrl' && location.presignedUrl)
        return {
          ...data,
          shared: false,
          file: await span.span('canvas.download', () =>
            throwOnErr(() => fetchBinary(location.presignedUrl, 'blob'))
          ),
        };
    }
    throw new ThrownResultError([
      { code: 'INVALID', message: 'Canvas content is not ready' },
    ]);
  });
}
