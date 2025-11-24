type MarkdownHighlightLocation = {
  type: 'md';
  nodeId: string;
};

type PdfHighlightLocation = {
  type: 'pdf';
  searchPage: number;
  highlightTerms: string[];
  searchSnippet: string;
  searchRawQuery: string;
};

export type SearchLocation = MarkdownHighlightLocation | PdfHighlightLocation;

export type ChannelContentHitData = {
  type: 'channel';
  id: string;
  content: string;
  senderId: string;
  sentAt: number;
  location?: SearchLocation;
};

type GenericContentHitData = {
  type?: undefined;
  content: string;
  location?: SearchLocation;
};

export type ContentHitData = GenericContentHitData | ChannelContentHitData;

export type SearchData = {
  nameHighlight: string | null;
  contentHitData: ContentHitData[] | null;
  source: 'local' | 'service';
};

export type WithSearch<T extends object> = T & {
  search: SearchData;
};
