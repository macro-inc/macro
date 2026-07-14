// Keep navigation metadata independent from the PDF viewer implementation so
// lightweight consumers do not pull the viewer onto the startup path.
export const URL_PARAMS = {
  pageNumber: 'pdf_page_number',
  yPos: 'pdf_page_y',
  x: 'pdf_page_x',
  width: 'pdf_width',
  height: 'pdf_height',
  annotationId: 'pdf_ann_id',
  searchPage: 'pdf_search_page',
  searchSnippet: 'pdf_search_snippet',
  searchRawQuery: 'pdf_search_raw_query',
  searchHighlightTerms: 'pdf_search_highlight_terms',
} as const;
