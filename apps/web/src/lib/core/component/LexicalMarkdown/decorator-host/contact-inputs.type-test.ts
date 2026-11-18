import type { ContactMentionDecoratorProps } from '@macro-inc/lexical-core';
import type { ContactMentionUIProps } from '../component/decorator/ContactMention';

type Assert<T extends true> = T;
type PersonProps = Extract<ContactMentionUIProps, { name: string }>;
type CompanyProps = Extract<ContactMentionUIProps, { isCompany: true }>;

export type ContactUiKeepsNullId = Assert<
  null extends ContactMentionUIProps['contactId'] ? true : false
>;
export type ContactUiKeepsNullEmailOrDomain = Assert<
  null extends ContactMentionUIProps['emailOrDomain'] ? true : false
>;
export type ContactUiKeepsNullMentionId = Assert<
  null extends ContactMentionUIProps['mentionUuid'] ? true : false
>;
export type CompanyUiKeepsNullName = Assert<
  null extends CompanyProps['name'] ? true : false
>;
export type PersonUiNameRemainsText = Assert<
  null extends PersonProps['name'] ? false : true
>;
export type PublicContactIdRemainsExact = Assert<
  null extends ContactMentionDecoratorProps['contactId'] ? false : true
>;
export type PublicContactNameRemainsExact = Assert<
  null extends ContactMentionDecoratorProps['name'] ? false : true
>;
export type SourceInfoStillFitsUiProps = Assert<
  ContactMentionDecoratorProps extends ContactMentionUIProps ? true : false
>;
