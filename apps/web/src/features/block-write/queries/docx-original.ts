import { thrownResultErrorHasCode } from '@core/util/result';
import { queryOptions } from '@tanstack/solid-query';
import { docxKeys } from './keys';

/** Share the original download and wait briefly for a newly uploaded DOCX. */
export function docxOriginalQueryOptions(
  documentId: string,
  download: () => Promise<Uint8Array>
) {
  const deadline = Date.now() + 30_000;
  return queryOptions({
    queryKey: docxKeys.original(documentId).queryKey,
    queryFn: download,
    // Only a confirmed processing response is retryable.
    retry: (_failureCount: number, error: Error) =>
      thrownResultErrorHasCode(error, 'CONFLICT') && Date.now() < deadline,
    retryDelay: 1_000,
  });
}
