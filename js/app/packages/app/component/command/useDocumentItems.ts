import { useSearchDocuments } from '@core/signal/search';
import type { BasicDocumentFileType } from '@service-storage/generated/schemas/basicDocumentFileType';
import { createMemo } from 'solid-js';
import type { CommandItemCard } from './KonsoleItem';

export function useDocumentItems(fullTextSearchTerm: () => string) {
  const documentSearchResults = useSearchDocuments(fullTextSearchTerm);

  return createMemo(() => {
    const docResults = documentSearchResults();
    if (!docResults) return [];

    const items: CommandItemCard[] = [];
    for (const doc of docResults.results) {
      if (doc.document_search_results.length === 0) continue;

      for (const result of doc.document_search_results) {
        const contents = result.highlight.content ?? [];
        contents.forEach((content, index) => {
          items.push({
            type: 'item',
            data: {
              id: doc.document_id,
              name: doc.document_name,
              fileType: doc.file_type as BasicDocumentFileType,
              itemType: 'document',
            },
            snippet: {
              content,
              locationId: result.node_id,
              fileType: doc.file_type,
              matchIndex: index,
            },
          });
        });
      }
    }
    return items;
  });
}
