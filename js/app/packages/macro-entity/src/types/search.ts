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

export type FileTypeWithLocation = 'md' | 'pdf';

export type SearchLocation = MarkdownHighlightLocation | PdfHighlightLocation;

export type ChannelMessageContentHighlight = {
  type: 'channel-message';
  id: string;
  content: string;
  senderId: string;
  sentAt: number;
  location?: SearchLocation;
};

type GenericContentHighlight = {
  type: undefined;
  content: string;
  location?: SearchLocation;
};

type ContentHighlight =
  | GenericContentHighlight
  | ChannelMessageContentHighlight;

export type WithSearch<T extends object> = T & {
  search: {
    nameHighlight: string | null;
    contentHighlights: ContentHighlight[] | null;
    source: 'local' | 'service';
  };
};
