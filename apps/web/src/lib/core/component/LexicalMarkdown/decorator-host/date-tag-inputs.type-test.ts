import type {
  DateMentionDecoratorProps,
  DateMentionInfo,
  TagMentionDecoratorProps,
} from '@macro-inc/lexical-core';
import type { DateMentionUIProps } from '../component/decorator/DateMention';
import type { TagMentionUIProps } from '../component/decorator/TagMention';

type Assert<T extends true> = T;

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

export type TagUiOptionIdRemainsText = Assert<
  null extends TagMentionUIProps['optionId'] ? false : true
>;
export type TagUiDefinitionIdRemainsText = Assert<
  null extends TagMentionUIProps['propertyDefinitionId'] ? false : true
>;
export type TagUiScopeRemainsUserOrTeam = Assert<
  TagMentionUIProps['scope'] extends 'user' | 'team' ? true : false
>;
export type TagUiNameRemainsText = Assert<
  TagMentionUIProps['name'] extends string ? true : false
>;
export type TagUiKeepsNullColor = Assert<
  null extends TagMentionUIProps['color'] ? true : false
>;
export type PublicTagColorRemainsExact = Assert<
  null extends TagMentionDecoratorProps['color'] ? false : true
>;
export type SourceTagFitsUiProps = Assert<
  TagMentionDecoratorProps extends TagMentionUIProps ? true : false
>;
