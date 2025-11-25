import type { EntityData } from './entity';

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

type ChannelMessageHighlightLocation = {
  type: 'channel';
  messageId: string;
};

export type SearchLocation =
  | MarkdownHighlightLocation
  | PdfHighlightLocation
  | ChannelMessageHighlightLocation;

export type ChannelContentHitData = {
  type: 'channel';
  id: string;
  content: string;
  senderId: string;
  sentAt: number;
  location: ChannelMessageHighlightLocation;
};

type MdContentHitData = {
  type: 'md';
  content: string;
  location: MarkdownHighlightLocation;
};

type PdfContentHitData = {
  type: 'pdf';
  content: string;
  location: PdfHighlightLocation;
};

type GenericContentHitData = {
  type?: undefined;
  content: string;
  location?: never;
};

export type DocumentContentHitData =
  | MdContentHitData
  | PdfContentHitData
  | GenericContentHitData;

export type ContentHitData<T extends EntityData = EntityData> = T extends {
  type: 'channel';
}
  ? ChannelContentHitData
  : T extends { type: 'document'; fileType: 'md' }
    ? MdContentHitData
    : T extends { type: 'document'; fileType: 'pdf' | 'docx' }
      ? PdfContentHitData
      : T extends { type: 'document' }
        ? DocumentContentHitData
        : GenericContentHitData;

export type SearchData<T extends EntityData = EntityData> = {
  nameHighlight: string | null;
  contentHitData: ContentHitData<T>[] | null;
  source: 'local' | 'service';
};

export type WithSearch<T extends EntityData> = T & {
  search: SearchData<T>;
};
