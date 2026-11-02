import { throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { getFileDocumentUrl } from '@queries/storage/file-document';
import { fetchPresignedBlobWithProgress } from '@service-storage/util/fetchPresigned';
import { queryOptions, skipToken } from '@tanstack/solid-query';
import {
  decodeTextPreview,
  mayContainText,
  TEXT_PREVIEW_MAX_BYTES,
} from '../core/text-preview';
import { unknownFileKeys } from './keys';

export type TextPreviewFile = {
  documentId: string;
  documentVersionId: number;
  fileType?: string | null;
};

function fetchTextFile(url: string, signal: AbortSignal, parent: Span) {
  return parent.span('file.transfer', async (span) => {
    const blob = await fetchPresignedBlobWithProgress(
      url,
      () => {},
      { signal },
      TEXT_PREVIEW_MAX_BYTES
    );
    if (blob.isOk()) span.setAttr('file.size', blob.value.size);
    return blob;
  });
}

/**
 * Resolves to null when the file holds no previewable text, which is final for
 * this version. A failed read rejects instead, so it is not cached and opening
 * the file again retries.
 */
function loadTextPreview(file: TextPreviewFile, signal: AbortSignal) {
  return Telemetry.span('file.text_preview', async (span) => {
    span.setAttr('document.id', file.documentId);
    span.setAttr('document.version_id', file.documentVersionId);
    span.setAttr('file.text_preview.outcome', 'unavailable');
    const url = await getFileDocumentUrl(file, span);
    signal.throwIfAborted();
    const blob = await throwOnErr(() => fetchTextFile(url, signal, span));
    const text = decodeTextPreview(new Uint8Array(await blob.arrayBuffer()));
    span.setAttr('file.text_preview.outcome', text ? 'text' : 'no_preview');
    return text;
  });
}

/** Cached by immutable file version. */
export function textPreviewQueryOptions(file: TextPreviewFile | undefined) {
  return queryOptions({
    queryKey: unknownFileKeys.textPreview(
      file?.documentId,
      file?.documentVersionId
    ).queryKey,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    queryFn:
      file && mayContainText(file.fileType)
        ? ({ signal }) => loadTextPreview(file, signal)
        : skipToken,
  });
}
