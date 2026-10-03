import { createSearchParams } from '@app/split-router';
import { type Accessor, createMemo } from 'solid-js';
import { URL_PARAMS } from '../constants';
import { pdfDetailSearch } from '../pdf-route';
import type { LocationBlockParams } from '../signal/location';

export function createPdfRouteTarget(documentId: Accessor<string>) {
  const [search] = createSearchParams(pdfDetailSearch);
  return createMemo<LocationBlockParams | undefined>(() => {
    // A fresh request must replay navigation even when its location is unchanged.
    search.seek;
    if (
      search.page < 1 ||
      (search.documentId && search.documentId !== documentId())
    )
      return;
    return {
      [URL_PARAMS.searchPage]: String(search.page),
      [URL_PARAMS.searchHighlightTerms]: JSON.stringify(search.highlightTerms),
      [URL_PARAMS.searchSnippet]: search.snippet,
      [URL_PARAMS.searchRawQuery]: search.query,
    };
  });
}
