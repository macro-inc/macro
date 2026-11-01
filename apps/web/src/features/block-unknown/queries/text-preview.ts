import { Telemetry } from '@macro-inc/observability';
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

/** Resolves to null when the file has no preview; the original stays downloadable. */
function loadTextPreview(file: TextPreviewFile, signal: AbortSignal) {
  return Telemetry.span('file.text_preview', async (span) => {
    span.setAttr('document.id', file.documentId);
    span.setAttr('document.version_id', file.documentVersionId);
    const url = await getFileDocumentUrl(file, span);
    signal.throwIfAborted();
    const blob = await fetchPresignedBlobWithProgress(
      url,
      () => {},
      { signal },
      TEXT_PREVIEW_MAX_BYTES
    );
    if (blob.isErr()) {
      span.setAttr('file.text_preview.outcome', 'unavailable');
      return null;
    }
    span.setAttr('file.size', blob.value.size);
    const text = decodeTextPreview(new Uint8Array(await blob.value.arrayBuffer()));
    span.setAttr('file.text_preview.outcome', text ? 'text' : 'not_text');
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
