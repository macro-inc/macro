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
  threadId?: string;
  messageId: string;
};

type EmailMessageHighlightLocation = {
  type: 'email';
  messageId: string;
};

export type SearchLocation =
  | MarkdownHighlightLocation
  | PdfHighlightLocation
  | ChannelMessageHighlightLocation
  | EmailMessageHighlightLocation;

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

export type EmailContentHitData = {
  type: 'email';
  content: string;
  sender: string;
  senderId: string;
  sentAt: number;
  location: EmailMessageHighlightLocation;
};

export type DocumentContentHitData =
  | MdContentHitData
  | PdfContentHitData
  | GenericContentHitData;

export type ContentHitData =
  | DocumentContentHitData
  | ChannelContentHitData
  | EmailContentHitData
  | GenericContentHitData;

export type SearchData = {
  nameHighlight: string | null;
  contentHitData: ContentHitData[] | null;
  source: 'local' | 'service';
};

export type WithSearch<T extends EntityData> = T & {
  search: SearchData;
};
