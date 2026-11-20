/**
 * Team libraries from document storage: the `.fig` designs the person can
 * access (the soup listing, narrowed to `fig` files) and their stored
 * files, read as the block reads its own.
 */

import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { isDocumentEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { createMemo } from 'solid-js';
import type {
  FigLibraryDocument,
  FigLibrarySource,
} from '../context/fig-libraries';

/** Fig designs only, recently opened first. */
export const FIG_LIBRARY_DESIGNS_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: 200, sort_method: 'viewed_updated' },
  body: compileToAst(
    queryStateFrom(defineQueryFilters({ include: { fileType: ['fig'] } }))
  ),
};

/** The designs `documentId`'s file may use as libraries. */
export function useFigLibrarySource(documentId: string): FigLibrarySource {
  const query = useSoupAstItemsQuery(() => FIG_LIBRARY_DESIGNS_ARGS);
  const documents = createMemo<FigLibraryDocument[] | undefined>(() => {
    if (!queryReadyGate(query)) return undefined;
    return query.data.entities
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
