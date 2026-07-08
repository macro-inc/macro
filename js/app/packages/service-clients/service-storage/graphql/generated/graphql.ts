/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type GraphqlCallBinaryExpr = {
  left: GraphqlCallExpr;
  right: GraphqlCallExpr;
};

export type GraphqlCallExpr =
  {   and: GraphqlCallBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlCallLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlCallExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlCallBinaryExpr; };

export type GraphqlCallLiteral =
  {   attended: boolean; callId?: never; channelId?: never; speaker?: never; status?: never; }
  |  { attended?: never;   callId: string | number; channelId?: never; speaker?: never; status?: never; }
  |  { attended?: never; callId?: never;   channelId: string | number; speaker?: never; status?: never; }
  |  { attended?: never; callId?: never; channelId?: never;   speaker: string; status?: never; }
  |  { attended?: never; callId?: never; channelId?: never; speaker?: never;   status: GraphqlCallStatus; };

export type GraphqlCallStatus =
  | 'ATTENDED'
  | 'MISSED'
  | 'UNATTENDED';

export type GraphqlChannelBinaryExpr = {
  left: GraphqlChannelExpr;
  right: GraphqlChannelExpr;
};

export type GraphqlChannelExpr =
  {   and: GraphqlChannelBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlChannelLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlChannelExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlChannelBinaryExpr; };

export type GraphqlChannelLiteral =
  {   channelId: string | number; channelType?: never; importance?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never;   channelType: GraphqlChannelTypeFilter; importance?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never;   importance: boolean; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never;   mention: string; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; mention?: never;   notificationDone: boolean; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; mention?: never; notificationDone?: never;   notificationSeen: boolean; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; mention?: never; notificationDone?: never; notificationSeen?: never;   organizationId: number; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never;   sender: string; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never;   teamId: string | number; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never;   threadId: string | number; };

export type GraphqlChannelThreadBinaryExpr = {
  left: GraphqlChannelThreadExpr;
  right: GraphqlChannelThreadExpr;
};

export type GraphqlChannelThreadExpr =
  {   and: GraphqlChannelThreadBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlChannelThreadLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlChannelThreadExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlChannelThreadBinaryExpr; };

export type GraphqlChannelThreadLiteral =
  {   channelId: string | number; notificationDone?: never; notificationSeen?: never; participant?: never; rootSender?: never; threadId?: never; }
  |  { channelId?: never;   notificationDone: boolean; notificationSeen?: never; participant?: never; rootSender?: never; threadId?: never; }
  |  { channelId?: never; notificationDone?: never;   notificationSeen: boolean; participant?: never; rootSender?: never; threadId?: never; }
  |  { channelId?: never; notificationDone?: never; notificationSeen?: never;   participant: string; rootSender?: never; threadId?: never; }
  |  { channelId?: never; notificationDone?: never; notificationSeen?: never; participant?: never;   rootSender: string; threadId?: never; }
  |  { channelId?: never; notificationDone?: never; notificationSeen?: never; participant?: never; rootSender?: never;   threadId: string | number; };

export type GraphqlChannelTypeFilter =
  | 'DIRECT_MESSAGE'
  | 'PRIVATE'
  | 'PUBLIC'
  | 'TEAM';

export type GraphqlChatBinaryExpr = {
  left: GraphqlChatExpr;
  right: GraphqlChatExpr;
};

export type GraphqlChatExpr =
  {   and: GraphqlChatBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlChatLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlChatExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlChatBinaryExpr; };

export type GraphqlChatLiteral =
  {   chatId: string | number; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never;   createdAt: GraphqlDateLiteral; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never;   importance: boolean; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never;   notificationDone: boolean; notificationSeen?: never; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never;   notificationSeen: boolean; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never;   owner: string; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never;   projectId: string | number; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never;   role: GraphqlChatRole; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; role?: never;   updatedAt: GraphqlDateLiteral; };

export type GraphqlChatRole =
  | 'ASSISTANT'
  | 'SYSTEM'
  | 'USER';

export type GraphqlCrmCompanyBinaryExpr = {
  left: GraphqlCrmCompanyExpr;
  right: GraphqlCrmCompanyExpr;
};

export type GraphqlCrmCompanyExpr =
  {   and: GraphqlCrmCompanyBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlCrmCompanyLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlCrmCompanyExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlCrmCompanyBinaryExpr; };

export type GraphqlCrmCompanyLiteral =
  {   hidden: boolean; id?: never; }
  |  { hidden?: never;   id: string | number; };

export type GraphqlCrmScope =
  {   addresses: Array<string>; domains?: never; }
  |  { addresses?: never;   domains: Array<string>; };

export type GraphqlDateLiteral =
  {   gt: string; gte?: never; lt?: never; lte?: never; }
  |  { gt?: never;   gte: string; lt?: never; lte?: never; }
  |  { gt?: never; gte?: never;   lt: string; lte?: never; }
  |  { gt?: never; gte?: never; lt?: never;   lte: string; };

export type GraphqlDocumentBinaryExpr = {
  left: GraphqlDocumentExpr;
  right: GraphqlDocumentExpr;
};

export type GraphqlDocumentExpr =
  {   and: GraphqlDocumentBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlDocumentLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlDocumentExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlDocumentBinaryExpr; };

export type GraphqlDocumentLiteral =
  {   createdAt: GraphqlDateLiteral; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never;   fileAssoc: string; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never;   fileType: string; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never;   id: string | number; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never;   importance: boolean; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never;   includeCbmAtmNc: boolean; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never;   isEmailAttachment: boolean; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never;   notificationDone: boolean; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never;   notificationSeen: boolean; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never;   owner: string; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never;   projectId: string | number; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never;   subType: GraphqlDocumentSubType; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never;   updatedAt: GraphqlDateLiteral; };

export type GraphqlDocumentSubType =
  | 'SNIPPET'
  | 'TASK';

export type GraphqlEmailBinaryExpr = {
  left: GraphqlEmailExpr;
  right: GraphqlEmailExpr;
};

export type GraphqlEmailExpr =
  {   and: GraphqlEmailBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlEmailLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlEmailExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlEmailBinaryExpr; };

export type GraphqlEmailFilterAst = {
  crmScope?: GraphqlCrmScope | null | undefined;
  tree?: GraphqlEmailExpr | null | undefined;
};

export type GraphqlEmailLiteral =
  {   bcc: GraphqlEmailValue; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never;   calendarOnly: boolean; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never;   cc: GraphqlEmailValue; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never;   createdAt: GraphqlDateLiteral; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never;   importance: boolean; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never;   notificationDone: boolean; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never;   notificationSeen: boolean; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never;   owner: string | number; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never;   projectId: string; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never;   recipient: GraphqlEmailValue; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never;   sender: GraphqlEmailValue; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never;   shared: GraphqlSharedEmailFilter; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never;   threadId: string | number; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never;   updatedAt: GraphqlDateLiteral; };

export type GraphqlEmailValue =
  {   complete: string; domain?: never; partial?: never; }
  |  { complete?: never;   domain: string; partial?: never; }
  |  { complete?: never; domain?: never;   partial: string; };

export type GraphqlEmailView =
  | 'ALL'
  | 'DRAFTS'
  | 'IMPORTANT'
  | 'INBOX'
  | 'OTHER'
  | 'SENT'
  | 'STARRED';

/** GraphQL input mirroring `item_filters::ast::EntityFilterAst`. */
export type GraphqlEntityFilterAst = {
  callFilter?: GraphqlCallExpr | null | undefined;
  channelFilter?: GraphqlChannelExpr | null | undefined;
  channelThreadFilter?: GraphqlChannelThreadExpr | null | undefined;
  chatFilter?: GraphqlChatExpr | null | undefined;
  crmCompanyFilter?: GraphqlCrmCompanyExpr | null | undefined;
  documentFilter?: GraphqlDocumentExpr | null | undefined;
  emailFilter?: GraphqlEmailFilterAst | null | undefined;
  foreignEntityFilter?: GraphqlForeignEntityExpr | null | undefined;
  projectFilter?: GraphqlProjectExpr | null | undefined;
  propertiesFilter?: GraphqlPropertiesExpr | null | undefined;
};

export type GraphqlForeignEntityBinaryExpr = {
  left: GraphqlForeignEntityExpr;
  right: GraphqlForeignEntityExpr;
};

export type GraphqlForeignEntityExpr =
  {   and: GraphqlForeignEntityBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlForeignEntityLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlForeignEntityExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlForeignEntityBinaryExpr; };

export type GraphqlForeignEntityLiteral =
  {   foreignEntityId: string; foreignEntitySource?: never; id?: never; includesMe?: never; notificationDone?: never; notificationSeen?: never; }
  |  { foreignEntityId?: never;   foreignEntitySource: string; id?: never; includesMe?: never; notificationDone?: never; notificationSeen?: never; }
  |  { foreignEntityId?: never; foreignEntitySource?: never;   id: string | number; includesMe?: never; notificationDone?: never; notificationSeen?: never; }
  |  { foreignEntityId?: never; foreignEntitySource?: never; id?: never;   includesMe: boolean; notificationDone?: never; notificationSeen?: never; }
  |  { foreignEntityId?: never; foreignEntitySource?: never; id?: never; includesMe?: never;   notificationDone: boolean; notificationSeen?: never; }
  |  { foreignEntityId?: never; foreignEntitySource?: never; id?: never; includesMe?: never; notificationDone?: never;   notificationSeen: boolean; };

export type GraphqlProjectBinaryExpr = {
  left: GraphqlProjectExpr;
  right: GraphqlProjectExpr;
};

export type GraphqlProjectExpr =
  {   and: GraphqlProjectBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlProjectLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlProjectExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlProjectBinaryExpr; };

export type GraphqlProjectLiteral =
  {   createdAt: GraphqlDateLiteral; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never;   importance: boolean; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never;   notificationDone: boolean; notificationSeen?: never; owner?: never; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never;   notificationSeen: boolean; owner?: never; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never;   owner: string; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never;   projectId: string | number; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never;   projectIdSelf: string | number; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; projectIdSelf?: never;   updatedAt: GraphqlDateLiteral; };

export type GraphqlPropertiesBinaryExpr = {
  left: GraphqlPropertiesExpr;
  right: GraphqlPropertiesExpr;
};

export type GraphqlPropertiesExpr =
  {   and: GraphqlPropertiesBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   literal: GraphqlPropertiesLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   not: GraphqlPropertiesExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   or: GraphqlPropertiesBinaryExpr; };

export type GraphqlPropertiesLiteral = {
  entityType?: GraphqlPropertyEntityType | null | undefined;
  propertyDefinitionId: string | number;
  value: GraphqlPropertyMatchValue;
};

export type GraphqlPropertyEntityType =
  | 'CHANNEL'
  | 'CHAT'
  | 'COMPANY'
  | 'DOCUMENT'
  | 'PROJECT'
  | 'TASK'
  | 'THREAD'
  | 'USER';

export type GraphqlPropertyMatchValue =
  {   entityRef: string; selectOption?: never; }
  |  { entityRef?: never;   selectOption: string | number; };

export type GraphqlSharedEmailFilter =
  | 'EXCLUDE'
  | 'INCLUDE'
  | 'ONLY';

/** GraphQL representation of supported simple Soup sorts. */
export type GraphqlSimpleSortMethod =
  /** Sort by creation timestamp. */
  | 'CREATED_AT'
  /** Sort by update timestamp. */
  | 'UPDATED_AT'
  /** Sort by most recently viewed. */
  | 'VIEWED_AT'
  /** Sort by viewed timestamp, falling back to updated timestamp. */
  | 'VIEWED_UPDATED';

export type GraphqlSoupDataType =
  /** Boolean true/false values. */
  | 'BOOLEAN'
  /** Date and time values. */
  | 'DATE'
  /** Entity reference property. */
  | 'ENTITY'
  /** Link value Property. */
  | 'LINK'
  /** Numeric values. */
  | 'NUMBER'
  /** Select property with numeric options. */
  | 'SELECT_NUMBER'
  /** Select property with string options. */
  | 'SELECT_STRING'
  /** String/text values. */
  | 'STRING'
  /** Tag property - user- or team-scoped colored labels (always multi-select). */
  | 'TAG';

/** GraphQL representation of Soup entity types. */
export type GraphqlSoupEntityType =
  /** Call entity. */
  | 'CALL'
  /** Channel entity. */
  | 'CHANNEL'
  /** Channel thread entity. */
  | 'CHANNEL_THREAD'
  /** Chat entity. */
  | 'CHAT'
  /** CRM company entity. */
  | 'CRM_COMPANY'
  /** Document entity. */
  | 'DOCUMENT'
  /** Email thread entity. */
  | 'EMAIL_THREAD'
  /** Foreign entity. */
  | 'FOREIGN_ENTITY'
  /** Project entity. */
  | 'PROJECT'
  /** Unknown or unsupported entity type. */
  | 'UNKNOWN';

export type GraphqlSoupPropertyEntityType =
  | 'CHANNEL'
  | 'CHAT'
  | 'COMPANY'
  | 'DOCUMENT'
  | 'PROJECT'
  | 'TASK'
  | 'THREAD'
  | 'USER';

/** Input for `Query.soup`. */
export type SoupInput = {
  /** Opaque cursor returned by a previous GraphQL Soup response. */
  cursor?: string | null | undefined;
  /** Email preview view used when hydrating email Soup items. */
  emailView?: GraphqlEmailView | null | undefined;
  /** Whether to return expanded Soup items. Defaults to true. */
  expand?: boolean | null | undefined;
  /** AST-shaped filters applied to each Soup entity type. */
  filters?: GraphqlEntityFilterAst | null | undefined;
  /** Maximum number of items to return. Defaults to 20, max 500. */
  limit?: number | null | undefined;
  /**
   * Simple timestamp sort. Defaults to VIEWED_AT. Frecency is intentionally
   * not supported by this initial GraphQL adapter.
   */
  sortMethod?: GraphqlSimpleSortMethod | null | undefined;
};

export type SoupQueryVariables = Exact<{
  input: SoupInput;
}>;


export type SoupQuery = { user: { id: string, soup: { nextCursor: string | null, hasMore: boolean, items: Array<{ id: string, entityType: GraphqlSoupEntityType, frecencyScore: number, entity:
          | { __typename: 'GraphqlSoupCall', id: string, channelId: string, channelName: string | null, createdBy: string, customName: string | null, summary: string | null, startedAt: string, endedAt: string | null, durationMs: number | null, isActive: boolean, status: string, attended: boolean, participants: Array<{ userId: string, joinedAt: string, leftAt: string | null }> }
          | { __typename: 'GraphqlSoupChannel', id: string, channelType: string, ownerId: string, organizationId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, interactedAt: string | null, channelName: string | null, channelTeamId: string | null, participants: Array<{ channelId: string, userId: string, role: string, joinedAt: string, leftAt: string | null }>, latestMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, latestNonThreadMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null }
          | { __typename: 'GraphqlSoupChannelThread', id: string, channelId: string, senderId: string, content: string, createdAt: string, updatedAt: string, effectiveUpdatedAt: string, replyCount: number }
          | { __typename: 'GraphqlSoupChat', id: string, ownerId: string, projectId: string | null, isPersistent: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, chatName: string, properties: Array<{ propertyDefinitionId: string, displayName: string, dataType: GraphqlSoupDataType, isMultiSelect: boolean, specificEntityType: string | null, isSystem: boolean, isMetadata: boolean, value: { kind: string, boolValue: boolean | null, numberValue: number | null, stringValue: string | null, dateValue: string | null, selectOptionIds: Array<string>, links: Array<string>, entityReferences: Array<{ entityId: string, entityType: GraphqlSoupPropertyEntityType, specificMessageId: string | null }> } | null }> }
          | { __typename: 'GraphqlSoupCrmCompany', id: string, description: string | null, emailSync: boolean, hidden: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, domains: Array<string>, crmTeamId: string, crmCompanyName: string | null, properties: Array<{ propertyDefinitionId: string, displayName: string, dataType: GraphqlSoupDataType, isMultiSelect: boolean, specificEntityType: string | null, isSystem: boolean, isMetadata: boolean, value: { kind: string, boolValue: boolean | null, numberValue: number | null, stringValue: string | null, dateValue: string | null, selectOptionIds: Array<string>, links: Array<string>, entityReferences: Array<{ entityId: string, entityType: GraphqlSoupPropertyEntityType, specificMessageId: string | null }> } | null }> }
          | { __typename: 'GraphqlSoupDocument', id: string, ownerId: string, fileType: string | null, projectId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, documentName: string, subType: { kind: string, isCompleted: boolean | null } | null, properties: Array<{ propertyDefinitionId: string, displayName: string, dataType: GraphqlSoupDataType, isMultiSelect: boolean, specificEntityType: string | null, isSystem: boolean, isMetadata: boolean, value: { kind: string, boolValue: boolean | null, numberValue: number | null, stringValue: string | null, dateValue: string | null, selectOptionIds: Array<string>, links: Array<string>, entityReferences: Array<{ entityId: string, entityType: GraphqlSoupPropertyEntityType, specificMessageId: string | null }> } | null }> }
          | { __typename: 'GraphqlSoupEmailThread', id: string, providerId: string | null, ownerId: string, inboxVisible: boolean, linkId: string | null, snippet: string | null, senderEmail: string | null, senderName: string | null, senderPhotoUrl: string | null, isRead: boolean, isDraft: boolean, isImportant: boolean, projectId: string | null, sortTs: string, createdAt: string, updatedAt: string, viewedAt: string | null, emailName: string | null, participants: Array<{ id: string, linkId: string, name: string | null, email: string | null, sfsPhotoUrl: string | null }>, attachments: Array<{ id: string, messageId: string, providerAttachmentId: string | null, filename: string | null, mimeType: string | null, sizeBytes: number | null, contentId: string | null, createdAt: string }>, labels: Array<{ id: string, linkId: string, providerLabelId: string, name: string, createdAt: string, messageListVisibility: string, labelListVisibility: string, type: string }>, properties: Array<{ propertyDefinitionId: string, displayName: string, dataType: GraphqlSoupDataType, isMultiSelect: boolean, specificEntityType: string | null, isSystem: boolean, isMetadata: boolean, value: { kind: string, boolValue: boolean | null, numberValue: number | null, stringValue: string | null, dateValue: string | null, selectOptionIds: Array<string>, links: Array<string>, entityReferences: Array<{ entityId: string, entityType: GraphqlSoupPropertyEntityType, specificMessageId: string | null }> } | null }> }
          | { __typename: 'GraphqlSoupForeignEntity', id: string, foreignEntityId: string, foreignEntitySource: string, storedForId: string, storedForAuthEntity: string, metadata: unknown, createdAt: string, updatedAt: string }
          | { __typename: 'GraphqlSoupProject', id: string, ownerId: string, parentId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, projectName: string, properties: Array<{ propertyDefinitionId: string, displayName: string, dataType: GraphqlSoupDataType, isMultiSelect: boolean, specificEntityType: string | null, isSystem: boolean, isMetadata: boolean, value: { kind: string, boolValue: boolean | null, numberValue: number | null, stringValue: string | null, dateValue: string | null, selectOptionIds: Array<string>, links: Array<string>, entityReferences: Array<{ entityId: string, entityType: GraphqlSoupPropertyEntityType, specificMessageId: string | null }> } | null }> }
         }> } } };

export type SoupPropertyFieldsFragment = { propertyDefinitionId: string, displayName: string, dataType: GraphqlSoupDataType, isMultiSelect: boolean, specificEntityType: string | null, isSystem: boolean, isMetadata: boolean, value: { kind: string, boolValue: boolean | null, numberValue: number | null, stringValue: string | null, dateValue: string | null, selectOptionIds: Array<string>, links: Array<string>, entityReferences: Array<{ entityId: string, entityType: GraphqlSoupPropertyEntityType, specificMessageId: string | null }> } | null };

export type SoupChannelMessageFieldsFragment = { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> };

export const SoupPropertyFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupPropertyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupProperty"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"propertyDefinitionId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}},{"kind":"Field","name":{"kind":"Name","value":"isMultiSelect"}},{"kind":"Field","name":{"kind":"Name","value":"specificEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"isMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"value"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"boolValue"}},{"kind":"Field","name":{"kind":"Name","value":"numberValue"}},{"kind":"Field","name":{"kind":"Name","value":"stringValue"}},{"kind":"Field","name":{"kind":"Name","value":"dateValue"}},{"kind":"Field","name":{"kind":"Name","value":"selectOptionIds"}},{"kind":"Field","name":{"kind":"Name","value":"entityReferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"specificMessageId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"links"}}]}}]}}]} as unknown as DocumentNode<SoupPropertyFieldsFragment, unknown>;
export const SoupChannelMessageFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupChannelMessageFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelMessage"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mentions"}}]}}]} as unknown as DocumentNode<SoupChannelMessageFieldsFragment, unknown>;
export const SoupDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Soup"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SoupInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"soup"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"frecencyScore"}},{"kind":"Field","name":{"kind":"Name","value":"entity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupDocument"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"documentName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"fileType"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"subType"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"isCompleted"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"chatName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"isPersistent"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupProject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"projectName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupEmailThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"providerId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"inboxVisible"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","alias":{"kind":"Name","value":"emailName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"snippet"}},{"kind":"Field","name":{"kind":"Name","value":"senderEmail"}},{"kind":"Field","name":{"kind":"Name","value":"senderName"}},{"kind":"Field","name":{"kind":"Name","value":"senderPhotoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"isDraft"}},{"kind":"Field","name":{"kind":"Name","value":"isImportant"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"sortTs"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"sfsPhotoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"attachments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"messageId"}},{"kind":"Field","name":{"kind":"Name","value":"providerAttachmentId"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"mimeType"}},{"kind":"Field","name":{"kind":"Name","value":"sizeBytes"}},{"kind":"Field","name":{"kind":"Name","value":"contentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"labels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"providerLabelId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"messageListVisibility"}},{"kind":"Field","name":{"kind":"Name","value":"labelListVisibility"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"channelName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"channelType"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"organizationId"}},{"kind":"Field","alias":{"kind":"Name","value":"channelTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"interactedAt"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestNonThreadMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"effectiveUpdatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"replyCount"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"channelName"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"customName"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"attended"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCrmCompany"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"crmTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","alias":{"kind":"Name","value":"crmCompanyName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"emailSync"}},{"kind":"Field","name":{"kind":"Name","value":"hidden"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupForeignEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntitySource"}},{"kind":"Field","name":{"kind":"Name","value":"storedForId"}},{"kind":"Field","name":{"kind":"Name","value":"storedForAuthEntity"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"nextCursor"}},{"kind":"Field","name":{"kind":"Name","value":"hasMore"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupPropertyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupProperty"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"propertyDefinitionId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}},{"kind":"Field","name":{"kind":"Name","value":"isMultiSelect"}},{"kind":"Field","name":{"kind":"Name","value":"specificEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"isMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"value"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"boolValue"}},{"kind":"Field","name":{"kind":"Name","value":"numberValue"}},{"kind":"Field","name":{"kind":"Name","value":"stringValue"}},{"kind":"Field","name":{"kind":"Name","value":"dateValue"}},{"kind":"Field","name":{"kind":"Name","value":"selectOptionIds"}},{"kind":"Field","name":{"kind":"Name","value":"entityReferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"specificMessageId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"links"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupChannelMessageFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelMessage"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mentions"}}]}}]} as unknown as DocumentNode<SoupQuery, SoupQueryVariables>;