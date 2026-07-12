import type { DateValue } from '@core/util/date';
import { isMatching, P } from 'ts-pattern';
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

type CallRecordSegmentHighlightLocation = {
  type: 'call_record';
  callId: string;
  transcriptId: string;
};

export type SearchLocation =
  | MarkdownHighlightLocation
  | PdfHighlightLocation
  | ChannelMessageHighlightLocation
  | EmailMessageHighlightLocation
  | CallRecordSegmentHighlightLocation;

export type ChannelContentHitData = {
  type: 'channel';
  id: string;
  content: string;
  senderId: string;
  sentAt: DateValue;
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
  sentAt: DateValue;
  location: EmailMessageHighlightLocation;
};

export type CallRecordContentHitData = {
  type: 'call_record';
  id: string;
  content: string;
  senderId: string;
  sentAt: DateValue;
  videoSeconds: number;
  location: CallRecordSegmentHighlightLocation;
};

export type DocumentContentHitData =
  | MdContentHitData
  | PdfContentHitData
  | GenericContentHitData;

export type ContentHitData =
  | DocumentContentHitData
  | ChannelContentHitData
  | EmailContentHitData
  | CallRecordContentHitData
  | GenericContentHitData;

export type SearchData = {
  nameHighlight: string | null;
  senderHighlightTerms: string[] | null;
  contentHitData: ContentHitData[] | null;
  source: 'local' | 'service';
};

export type WithSearch<T extends EntityData> = T & {
  search: SearchData;
};

export const isSearchEntity = <T extends EntityData>(
  entity: T
): entity is WithSearch<T> => 'search' in entity;

export const isCallRecordHit = (
  hit: ContentHitData
): hit is CallRecordContentHitData => hit.type === 'call_record';

/** Content hits that carry sender + sent_at (channel / email / call_record). */
type HitWithSender =
  | ChannelContentHitData
  | EmailContentHitData
  | CallRecordContentHitData;

export const hitHasSender = isMatching({
  type: P.union('channel', 'email', 'call_record'),
}) as (hit: ContentHitData) => hit is HitWithSender;
