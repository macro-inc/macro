import { type Span, Telemetry } from '@macro-inc/observability';
import { getFileDocumentUrl } from '@queries/storage/file-document';
import { fetchPresignedBlobWithProgress } from '@service-storage/util/fetchPresigned';
import { queryOptions, skipToken } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
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

/** Resolves to null when the file has no preview; the original stays downloadable. */
function loadTextPreview(file: TextPreviewFile, signal: AbortSignal) {
  return Telemetry.span('file.text_preview', async (span) => {
    span.setAttr('document.id', file.documentId);
    span.setAttr('document.version_id', file.documentVersionId);
    const url = await ResultAsync.fromPromise(
      getFileDocumentUrl(file, span),
      (error) => error
    );
    if (url.isErr()) {
      span.setAttr('file.text_preview.outcome', 'unavailable');
      return null;
    }
    signal.throwIfAborted();
    const blob = await fetchTextFile(url.value, signal, span);
    if (blob.isErr()) {
      span.setAttr('file.text_preview.outcome', 'unavailable');
      return null;
    }
    const text = decodeTextPreview(
      new Uint8Array(await blob.value.arrayBuffer())
    );
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
