import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';

export const spreadsheetDetailSearch = {
  namespace: 'spreadsheet-detail',
  schema: z.object({
    documentId: z.string(),
    commentId: z.string(),
    share: z.string(),
    seek: z.string(),
  }),
  defaults: { documentId: '', commentId: '', share: '', seek: '' },
};

export const spreadsheetDetailSearchCodec = createSearchParamsCodec(
  spreadsheetDetailSearch
);

/** Normalize explicit host input without borrowing an ancestor route. */
export function spreadsheetLocationParams(
  params?: object
): Record<string, string> {
  const source = (params ?? {}) as Record<string, unknown>;
  return {
    ...(typeof source.comment_id === 'string'
      ? { comment_id: source.comment_id }
      : {}),
    ...(typeof source.share === 'string' ? { share: source.share } : {}),
  };
}

export function spreadsheetLocationUpdates(
  documentId: string,
  params: object = {},
  seek: string = crypto.randomUUID()
) {
  const location = spreadsheetLocationParams(params);
  return {
    [spreadsheetDetailSearch.namespace]: spreadsheetDetailSearchCodec.serialize(
      {
        documentId,
        commentId: location.comment_id ?? '',
        share: location.share ?? '',
        seek,
      }
    ),
  };
}
