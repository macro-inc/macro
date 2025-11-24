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

export type ChannelMessageContentHitData = {
  type: 'channel-message';
  id: string;
  content: string;
  senderId: string;
  sentAt: number;
  location?: SearchLocation;
};

type GenericContentHitData = {
  type: undefined;
  content: string;
  location?: SearchLocation;
};

export type ContentHitData =
  | GenericContentHitData
  | ChannelMessageContentHitData;

export type WithSearch<T extends object> = T & {
  search: {
    nameHighlight: string | null;
    contentHitData: ContentHitData[] | null;
    source: 'local' | 'service';
  };
};
