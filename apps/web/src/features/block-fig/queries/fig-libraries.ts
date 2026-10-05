/**
 * Team libraries from document storage: the `.fig` designs the person can
 * access (the soup listing, narrowed to `fig` files) and their stored
 * files, read as the block reads its own.
 */

import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { isDocumentEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { useSoupItemsQuery } from '@queries/soup/items';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { createMemo } from 'solid-js';
import type {
  FigLibraryDocument,
  FigLibrarySource,
} from '../context/fig-libraries';

const DESIGNS_LIMIT = 200;
const STALE_TIME = 60 * 1000;

/** The designs `documentId`'s file may use as libraries. */
export function useFigLibrarySource(documentId: string): FigLibrarySource {
  const query = useSoupItemsQuery(
    () => ({
      params: { limit: DESIGNS_LIMIT, sort_method: 'viewed_updated' },
      body: {
        ...QUERY_FILTERS_BASE,
        document_filters: { file_types: ['fig'] },
      },
    }),
    () => ({ staleTime: STALE_TIME })
  );
  const documents = createMemo<FigLibraryDocument[] | undefined>(() => {
    if (!queryReadyGate(query)) return undefined;
    return query.data
      .filter(isDocumentEntity)
      .filter((d) => d.fileType === 'fig')
      .map((d) => ({ id: d.id, name: d.name }));
  });
  return {
    documentId,
    documents,
    load: loadFigDocument,
  };
}

/** A design's stored file, as it is now. */
async function loadFigDocument(id: string): Promise<ArrayBuffer> {
  const data = await fetchBinaryDocumentData(id);
  if (data.isErr()) {
    throw new Error(data.error[0]?.message ?? 'The library could not be read.');
  }
  const bytes = await fetchBinary(data.value.blobUrl, 'arraybuffer');
  if (bytes.isErr()) {
    throw new Error(
      bytes.error[0]?.message ?? 'The library could not be read.'
    );
  }
  return bytes.value;
}
