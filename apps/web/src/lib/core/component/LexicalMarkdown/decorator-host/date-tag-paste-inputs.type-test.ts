import type {
  DateMentionDecoratorProps,
  DateMentionInfo,
  PasteNodeDecoratorProps,
  TagMentionDecoratorProps,
} from '@macro-inc/lexical-core';
import type { DateMentionUIProps } from '../component/decorator/DateMention';
import type { PasteNodeUIProps } from '../component/decorator/PasteNode';
import type { TagMentionUIProps } from '../component/decorator/TagMention';

type Assert<T extends true> = T;
type PastedProps = Exclude<PasteNodeUIProps, { origin: 'referenced' }>;
type ReferencedProps = Extract<PasteNodeUIProps, { origin: 'referenced' }>;

export type DateUiKeepsNullDate = Assert<
  null extends DateMentionUIProps['date'] ? true : false
>;
export type DateUiKeepsNullDisplayFormat = Assert<
  null extends DateMentionUIProps['displayFormat'] ? true : false
>;
export type DateUiKeepsNullMentionId = Assert<
  null extends DateMentionUIProps['mentionUuid'] ? true : false
>;
export type PublicDateRemainsExact = Assert<
  null extends DateMentionDecoratorProps['date'] ? false : true
>;
export type PublicDateMentionIdRemainsExact = Assert<
  null extends DateMentionInfo['mentionUuid'] ? false : true
>;
export type SourceDateFitsUiProps = Assert<
  DateMentionDecoratorProps & DateMentionInfo extends DateMentionUIProps
    ? true
    : false
>;

export type TagUiKeepsNullOptionId = Assert<
  null extends TagMentionUIProps['optionId'] ? true : false
>;
export type TagUiKeepsNullDefinitionId = Assert<
  null extends TagMentionUIProps['propertyDefinitionId'] ? true : false
>;
export type TagUiKeepsNullScope = Assert<
  null extends TagMentionUIProps['scope'] ? true : false
>;
export type TagUiScopeStaysUserOrTeam = Assert<
  string extends TagMentionUIProps['scope'] ? false : true
>;
export type TagUiKeepsNullName = Assert<
  null extends TagMentionUIProps['name'] ? true : false
>;
export type TagUiKeepsNullColor = Assert<
  null extends TagMentionUIProps['color'] ? true : false
>;
export type PublicTagNameRemainsExact = Assert<
  null extends TagMentionDecoratorProps['name'] ? false : true
>;
export type SourceTagFitsUiProps = Assert<
  TagMentionDecoratorProps extends TagMentionUIProps ? true : false
>;

export type PastedUiKeepsNullContent = Assert<
  null extends PastedProps['content'] ? true : false
>;
export type ReferencedUiContentRemainsText = Assert<
  null extends ReferencedProps['content'] ? false : true
>;
export type PublicPasteContentRemainsExact = Assert<
  null extends PasteNodeDecoratorProps['content'] ? false : true
>;
