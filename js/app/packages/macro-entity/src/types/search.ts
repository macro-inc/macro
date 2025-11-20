type MarkdownHighlightLocation = {
  type: 'md';
  nodeId: string;
};

type PdfHighlightLocation = {
  type: 'pdf';
  searchPage: number;
  searchMatchNumOnPage: number;
  searchTerm: string;
  searchSnippet: string;
  highlightedContent: string;
};

export type FileTypeWithLocation = 'md' | 'pdf';

export type SearchLocation = MarkdownHighlightLocation | PdfHighlightLocation;

type ContentHighlight = {
  content: string;
  location?: SearchLocation;
};

export type WithSearch<T extends object> = T & {
  search: {
    nameHighlight: string | null;
    contentHighlights: ContentHighlight[] | null;
    source: 'local' | 'service';
  };
};
