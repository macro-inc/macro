/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
/** The two operands of a recursive `CallFilterExpr` binary expression. */
export type GraphqlCallBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlCallExpr;
  /** The right-hand expression. */
  right: GraphqlCallExpr;
};

/** A recursive `CallFilterExpr` filter expression. */
export type GraphqlCallExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlCallBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlCallLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlCallExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlCallBinaryExpr; };

/** GraphQL input representing the call literal. */
export type GraphqlCallLiteral =
  {   /** The attended option. */
  attended: boolean; callId?: never; channelId?: never; speaker?: never; status?: never; }
  |  { attended?: never;   /** The call id option. */
  callId: string | number; channelId?: never; speaker?: never; status?: never; }
  |  { attended?: never; callId?: never;   /** The channel id option. */
  channelId: string | number; speaker?: never; status?: never; }
  |  { attended?: never; callId?: never; channelId?: never;   /** The speaker option. */
  speaker: string; status?: never; }
  |  { attended?: never; callId?: never; channelId?: never; speaker?: never;   /** The status option. */
  status: GraphqlCallStatus; };

/** GraphQL input representing the call status. */
export type GraphqlCallStatus =
  /** The attended option. */
  | 'ATTENDED'
  /** The missed option. */
  | 'MISSED'
  /** The unattended option. */
  | 'UNATTENDED';

/** The two operands of a recursive `ChannelFilterExpr` binary expression. */
export type GraphqlChannelBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlChannelExpr;
  /** The right-hand expression. */
  right: GraphqlChannelExpr;
};

/** A recursive `ChannelFilterExpr` filter expression. */
export type GraphqlChannelExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlChannelBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlChannelLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlChannelExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlChannelBinaryExpr; };

/** GraphQL input representing the channel literal. */
export type GraphqlChannelLiteral =
  {   /** The channel id option. */
  channelId: string | number; channelType?: never; importance?: never; isParticipant?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never;   /** The channel type option. */
  channelType: GraphqlChannelTypeFilter; importance?: never; isParticipant?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never;   /** The importance option. */
  importance: boolean; isParticipant?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never;   /**
   * The is participant option. Filters by whether the requesting user is an
   * active participant; its presence widens the candidate set to team channels
   * of the user's teams they have not joined.
   */
  isParticipant: boolean; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; isParticipant?: never;   /** The mention option. */
  mention: string; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; isParticipant?: never; mention?: never;   /** The notification done option. */
  notificationDone: boolean; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; isParticipant?: never; mention?: never; notificationDone?: never;   /** The notification seen option. */
  notificationSeen: boolean; organizationId?: never; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; isParticipant?: never; mention?: never; notificationDone?: never; notificationSeen?: never;   /** The organization id option. */
  organizationId: number; sender?: never; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; isParticipant?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never;   /** The sender option. */
  sender: string; teamId?: never; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; isParticipant?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never;   /** The team id option. */
  teamId: string | number; threadId?: never; }
  |  { channelId?: never; channelType?: never; importance?: never; isParticipant?: never; mention?: never; notificationDone?: never; notificationSeen?: never; organizationId?: never; sender?: never; teamId?: never;   /** The thread id option. */
  threadId: string | number; };

/** The two operands of a recursive `ChannelThreadFilterExpr` binary expression. */
export type GraphqlChannelThreadBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlChannelThreadExpr;
  /** The right-hand expression. */
  right: GraphqlChannelThreadExpr;
};

/** A recursive `ChannelThreadFilterExpr` filter expression. */
export type GraphqlChannelThreadExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlChannelThreadBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlChannelThreadLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlChannelThreadExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlChannelThreadBinaryExpr; };

/** GraphQL input representing the channel thread literal. */
export type GraphqlChannelThreadLiteral =
  {   /** The channel id option. */
  channelId: string | number; notificationDone?: never; notificationSeen?: never; participant?: never; rootSender?: never; threadId?: never; }
  |  { channelId?: never;   /** The notification done option. */
  notificationDone: boolean; notificationSeen?: never; participant?: never; rootSender?: never; threadId?: never; }
  |  { channelId?: never; notificationDone?: never;   /** The notification seen option. */
  notificationSeen: boolean; participant?: never; rootSender?: never; threadId?: never; }
  |  { channelId?: never; notificationDone?: never; notificationSeen?: never;   /** The participant option. */
  participant: string; rootSender?: never; threadId?: never; }
  |  { channelId?: never; notificationDone?: never; notificationSeen?: never; participant?: never;   /** The root sender option. */
  rootSender: string; threadId?: never; }
  |  { channelId?: never; notificationDone?: never; notificationSeen?: never; participant?: never; rootSender?: never;   /** The thread id option. */
  threadId: string | number; };

/** GraphQL input representing the channel type filter. */
export type GraphqlChannelTypeFilter =
  /** The direct message option. */
  | 'DIRECT_MESSAGE'
  /** The private option. */
  | 'PRIVATE'
  /** The public option. */
  | 'PUBLIC'
  /** The team option. */
  | 'TEAM';

/** The two operands of a recursive `ChatFilterExpr` binary expression. */
export type GraphqlChatBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlChatExpr;
  /** The right-hand expression. */
  right: GraphqlChatExpr;
};

/** A recursive `ChatFilterExpr` filter expression. */
export type GraphqlChatExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlChatBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlChatLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlChatExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlChatBinaryExpr; };

/** GraphQL input representing the chat literal. */
export type GraphqlChatLiteral =
  {   /** The chat id option. */
  chatId: string | number; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never;   /** The created at option. */
  createdAt: GraphqlDateLiteral; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never;   /** The importance option. */
  importance: boolean; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never;   /** The notification done option. */
  notificationDone: boolean; notificationSeen?: never; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never;   /** The notification seen option. */
  notificationSeen: boolean; owner?: never; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never;   /** The owner option. */
  owner: string; projectId?: never; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never;   /** The project id option. */
  projectId: string | number; role?: never; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never;   /** The role option. */
  role: GraphqlChatRole; updatedAt?: never; }
  |  { chatId?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; role?: never;   /** The updated at option. */
  updatedAt: GraphqlDateLiteral; };

/** GraphQL input representing the chat role. */
export type GraphqlChatRole =
  /** The assistant option. */
  | 'ASSISTANT'
  /** The system option. */
  | 'SYSTEM'
  /** The user option. */
  | 'USER';

/** The two operands of a recursive `CrmCompanyFilterExpr` binary expression. */
export type GraphqlCrmCompanyBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlCrmCompanyExpr;
  /** The right-hand expression. */
  right: GraphqlCrmCompanyExpr;
};

/** A recursive `CrmCompanyFilterExpr` filter expression. */
export type GraphqlCrmCompanyExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlCrmCompanyBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlCrmCompanyLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlCrmCompanyExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlCrmCompanyBinaryExpr; };

/** GraphQL input representing the crm company literal. */
export type GraphqlCrmCompanyLiteral =
  {   /** The hidden option. */
  hidden: boolean; id?: never; }
  |  { hidden?: never;   /** The id option. */
  id: string | number; };

/** GraphQL input representing the crm scope. */
export type GraphqlCrmScope =
  {   /** The addresses option. */
  addresses: Array<string>; domains?: never; }
  |  { addresses?: never;   /** The domains option. */
  domains: Array<string>; };

/** GraphQL input representing the date literal. */
export type GraphqlDateLiteral =
  {   /** The gt option. */
  gt: string; gte?: never; lt?: never; lte?: never; }
  |  { gt?: never;   /** The gte option. */
  gte: string; lt?: never; lte?: never; }
  |  { gt?: never; gte?: never;   /** The lt option. */
  lt: string; lte?: never; }
  |  { gt?: never; gte?: never; lt?: never;   /** The lte option. */
  lte: string; };

/** The two operands of a recursive `DocumentFilterExpr` binary expression. */
export type GraphqlDocumentBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlDocumentExpr;
  /** The right-hand expression. */
  right: GraphqlDocumentExpr;
};

/** A recursive `DocumentFilterExpr` filter expression. */
export type GraphqlDocumentExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlDocumentBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlDocumentLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlDocumentExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlDocumentBinaryExpr; };

/** GraphQL input representing the document literal. */
export type GraphqlDocumentLiteral =
  {   /** The created at option. */
  createdAt: GraphqlDateLiteral; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never;   /** The file assoc option. */
  fileAssoc: string; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never;   /** The file type option. */
  fileType: string; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never;   /** The id option. */
  id: string | number; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never;   /** The importance option. */
  importance: boolean; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never;   /** The include cbm atm nc option. */
  includeCbmAtmNc: boolean; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never;   /** The is email attachment option. */
  isEmailAttachment: boolean; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never;   /** The notification done option. */
  notificationDone: boolean; notificationSeen?: never; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never;   /** The notification seen option. */
  notificationSeen: boolean; owner?: never; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never;   /** The owner option. */
  owner: string; projectId?: never; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never;   /** The project id option. */
  projectId: string | number; subType?: never; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never;   /** The sub type option. */
  subType: GraphqlDocumentSubType; updatedAt?: never; }
  |  { createdAt?: never; fileAssoc?: never; fileType?: never; id?: never; importance?: never; includeCbmAtmNc?: never; isEmailAttachment?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; subType?: never;   /** The updated at option. */
  updatedAt: GraphqlDateLiteral; };

/** GraphQL input representing the document sub type. */
export type GraphqlDocumentSubType =
  /** The snippet option. */
  | 'SNIPPET'
  /** The task option. */
  | 'TASK';

/** The two operands of a recursive `EmailFilterExpr` binary expression. */
export type GraphqlEmailBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlEmailExpr;
  /** The right-hand expression. */
  right: GraphqlEmailExpr;
};

/** A recursive `EmailFilterExpr` filter expression. */
export type GraphqlEmailExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlEmailBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlEmailLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlEmailExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlEmailBinaryExpr; };

/** GraphQL input representing the email filter ast. */
export type GraphqlEmailFilterAst = {
  /** The crm scope. */
  crmScope?: GraphqlCrmScope | null | undefined;
  /** The tree. */
  tree?: GraphqlEmailExpr | null | undefined;
};

/** GraphQL input representing the email literal. */
export type GraphqlEmailLiteral =
  {   /** The bcc option. */
  bcc: GraphqlEmailValue; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never;   /** The calendar only option. */
  calendarOnly: boolean; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never;   /** The cc option. */
  cc: GraphqlEmailValue; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never;   /** The created at option. */
  createdAt: GraphqlDateLiteral; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never;   /** The importance option. */
  importance: boolean; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never;   /** The notification done option. */
  notificationDone: boolean; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never;   /** The notification seen option. */
  notificationSeen: boolean; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never;   /** The owner option. */
  owner: string | number; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never;   /** The project id option. */
  projectId: string; recipient?: never; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never;   /** The recipient option. */
  recipient: GraphqlEmailValue; sender?: never; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never;   /** The sender option. */
  sender: GraphqlEmailValue; shared?: never; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never;   /** The shared option. */
  shared: GraphqlSharedEmailFilter; threadId?: never; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never;   /** The thread id option. */
  threadId: string | number; updatedAt?: never; }
  |  { bcc?: never; calendarOnly?: never; cc?: never; createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; recipient?: never; sender?: never; shared?: never; threadId?: never;   /** The updated at option. */
  updatedAt: GraphqlDateLiteral; };

/** GraphQL input representing the email value. */
export type GraphqlEmailValue =
  {   /** The complete option. */
  complete: string; domain?: never; partial?: never; }
  |  { complete?: never;   /** The domain option. */
  domain: string; partial?: never; }
  |  { complete?: never; domain?: never;   /** The partial option. */
  partial: string; };

/** GraphQL input representing the email view. */
export type GraphqlEmailView =
  /** The all option. */
  | 'ALL'
  /** The drafts option. */
  | 'DRAFTS'
  /** The important option. */
  | 'IMPORTANT'
  /** The inbox option. */
  | 'INBOX'
  /** The other option. */
  | 'OTHER'
  /** The sent option. */
  | 'SENT'
  /** The starred option. */
  | 'STARRED';

/** GraphQL input mirroring `item_filters::ast::EntityFilterAst`. */
export type GraphqlEntityFilterAst = {
  /** The call filter to apply. */
  callFilter?: GraphqlCallExpr | null | undefined;
  /** The channel filter to apply. */
  channelFilter?: GraphqlChannelExpr | null | undefined;
  /** The channel thread filter to apply. */
  channelThreadFilter?: GraphqlChannelThreadExpr | null | undefined;
  /** The chat filter to apply. */
  chatFilter?: GraphqlChatExpr | null | undefined;
  /** The crm company filter to apply. */
  crmCompanyFilter?: GraphqlCrmCompanyExpr | null | undefined;
  /** The document filter to apply. */
  documentFilter?: GraphqlDocumentExpr | null | undefined;
  /** The email filter to apply. */
  emailFilter?: GraphqlEmailFilterAst | null | undefined;
  /** The foreign entity filter to apply. */
  foreignEntityFilter?: GraphqlForeignEntityExpr | null | undefined;
  /** The project filter to apply. */
  projectFilter?: GraphqlProjectExpr | null | undefined;
  /** The properties filter to apply. */
  propertiesFilter?: GraphqlPropertiesExpr | null | undefined;
};

/** Input identifying an entity referenced by a property value. */
export type GraphqlEntityReferenceInput = {
  /** Identifier of the referenced entity. */
  entityId: string;
  /** Type of the referenced entity. */
  entityType: GraphqlPropertyEntityType;
  /** Specific message when the reference targets a thread message. */
  specificMessageId?: string | number | null | undefined;
};

/** The two operands of a recursive `ForeignEntityFilterExpr` binary expression. */
export type GraphqlForeignEntityBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlForeignEntityExpr;
  /** The right-hand expression. */
  right: GraphqlForeignEntityExpr;
};

/** A recursive `ForeignEntityFilterExpr` filter expression. */
export type GraphqlForeignEntityExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlForeignEntityBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlForeignEntityLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlForeignEntityExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlForeignEntityBinaryExpr; };

/** GraphQL input representing the foreign entity literal. */
export type GraphqlForeignEntityLiteral =
  {   /** The foreign entity id option. */
  foreignEntityId: string; foreignEntitySource?: never; id?: never; includesMe?: never; notificationDone?: never; notificationSeen?: never; }
  |  { foreignEntityId?: never;   /** The foreign entity source option. */
  foreignEntitySource: string; id?: never; includesMe?: never; notificationDone?: never; notificationSeen?: never; }
  |  { foreignEntityId?: never; foreignEntitySource?: never;   /** The id option. */
  id: string | number; includesMe?: never; notificationDone?: never; notificationSeen?: never; }
  |  { foreignEntityId?: never; foreignEntitySource?: never; id?: never;   /** The includes me option. */
  includesMe: boolean; notificationDone?: never; notificationSeen?: never; }
  |  { foreignEntityId?: never; foreignEntitySource?: never; id?: never; includesMe?: never;   /** The notification done option. */
  notificationDone: boolean; notificationSeen?: never; }
  |  { foreignEntityId?: never; foreignEntitySource?: never; id?: never; includesMe?: never; notificationDone?: never;   /** The notification seen option. */
  notificationSeen: boolean; };

/** Grouping modes supported by grouped Soup. */
export type GraphqlGroupByField =
  /** Group into date buckets. */
  | 'DATE'
  /** Group by Soup entity type. */
  | 'ENTITY_TYPE'
  /** Group by containing project. */
  | 'PROJECT'
  /** Group by a property value. */
  | 'PROPERTY';

/** GraphQL representation of a field used to group Soup items. */
export type GraphqlGroupByInput = {
  /** Optional property entity type restriction. */
  entityType?: GraphqlPropertyEntityType | null | undefined;
  /** The kind of grouping to perform. */
  field: GraphqlGroupByField;
  /** Property definition to group by when `field` is `PROPERTY`. */
  propertyDefinitionId?: string | number | null | undefined;
};

/** The two operands of a recursive `ProjectFilterExpr` binary expression. */
export type GraphqlProjectBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlProjectExpr;
  /** The right-hand expression. */
  right: GraphqlProjectExpr;
};

/** A recursive `ProjectFilterExpr` filter expression. */
export type GraphqlProjectExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlProjectBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlProjectLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlProjectExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlProjectBinaryExpr; };

/** GraphQL input representing the project literal. */
export type GraphqlProjectLiteral =
  {   /** The created at option. */
  createdAt: GraphqlDateLiteral; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never;   /** The importance option. */
  importance: boolean; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never;   /** The notification done option. */
  notificationDone: boolean; notificationSeen?: never; owner?: never; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never;   /** The notification seen option. */
  notificationSeen: boolean; owner?: never; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never;   /** The owner option. */
  owner: string; projectId?: never; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never;   /** The project id option. */
  projectId: string | number; projectIdSelf?: never; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never;   /** The project id self option. */
  projectIdSelf: string | number; updatedAt?: never; }
  |  { createdAt?: never; importance?: never; notificationDone?: never; notificationSeen?: never; owner?: never; projectId?: never; projectIdSelf?: never;   /** The updated at option. */
  updatedAt: GraphqlDateLiteral; };

/** The two operands of a recursive `PropertiesFilterExpr` binary expression. */
export type GraphqlPropertiesBinaryExpr = {
  /** The left-hand expression. */
  left: GraphqlPropertiesExpr;
  /** The right-hand expression. */
  right: GraphqlPropertiesExpr;
};

/** A recursive `PropertiesFilterExpr` filter expression. */
export type GraphqlPropertiesExpr =
  {   /** Matches when both expressions match. */
  and: GraphqlPropertiesBinaryExpr; literal?: never; not?: never; or?: never; }
  |  { and?: never;   /** Matches a domain-specific literal condition. */
  literal: GraphqlPropertiesLiteral; not?: never; or?: never; }
  |  { and?: never; literal?: never;   /** Negates an expression. */
  not: GraphqlPropertiesExpr; or?: never; }
  |  { and?: never; literal?: never; not?: never;   /** Matches when either expression matches. */
  or: GraphqlPropertiesBinaryExpr; };

/** GraphQL input for matching a property value on an entity. */
export type GraphqlPropertiesLiteral = {
  /** Optional entity type scope for the property match. */
  entityType?: GraphqlPropertyEntityType | null | undefined;
  /** Property definition id to match. */
  propertyDefinitionId: string | number;
  /** Value to compare against the property. */
  value: GraphqlPropertyMatchValue;
};

/** A property definition's supported value type. */
export type GraphqlPropertyDataType =
  /** Boolean true/false values. */
  | 'BOOLEAN'
  /** Date and time values. */
  | 'DATE'
  /** References to other entities. */
  | 'ENTITY'
  /** URL values. */
  | 'LINK'
  /** Numeric values. */
  | 'NUMBER'
  /** A select property with numeric options. */
  | 'SELECT_NUMBER'
  /** A select property with string options. */
  | 'SELECT_STRING'
  /** String or text values. */
  | 'STRING'
  /** User- or team-scoped colored labels. */
  | 'TAG';

/** An entity type supported by the properties domain. */
export type GraphqlPropertyEntityType =
  /** Call record entity. */
  | 'CALL_RECORD'
  /** Channel entity. */
  | 'CHANNEL'
  /** Chat entity. */
  | 'CHAT'
  /** Company entity. */
  | 'COMPANY'
  /** Document entity. */
  | 'DOCUMENT'
  /** Project entity. */
  | 'PROJECT'
  /** Task entity. */
  | 'TASK'
  /** Thread entity. */
  | 'THREAD'
  /** User entity. */
  | 'USER';

/** GraphQL input value used when matching a property. */
export type GraphqlPropertyMatchValue =
  {   /** Entity reference id to match. */
  entityRef: string; selectOption?: never; }
  |  { entityRef?: never;   /** Select option id to match. */
  selectOption: string | number; };

/** Canonical entity type accepted for property targets. */
export type GraphqlPropertyTargetEntityType =
  /** Call record target. */
  | 'CALL_RECORD'
  /** Channel target. */
  | 'CHANNEL'
  /** Chat target. */
  | 'CHAT'
  /** CRM company target. */
  | 'COMPANY'
  /** Document target, including tasks and snippets. */
  | 'DOCUMENT'
  /** Project target. */
  | 'PROJECT'
  /** Email thread target. */
  | 'THREAD'
  /** User target. */
  | 'USER';

/** A typed value accepted when setting an entity property. */
export type GraphqlSetPropertyValue =
  {   /** A Boolean value. */
  boolean: boolean; date?: never; entityReference?: never; link?: never; multiEntityReference?: never; multiLink?: never; multiSelectOption?: never; number?: never; selectOption?: never; string?: never; }
  |  { boolean?: never;   /** An RFC 3339 date-time value. */
  date: string; entityReference?: never; link?: never; multiEntityReference?: never; multiLink?: never; multiSelectOption?: never; number?: never; selectOption?: never; string?: never; }
  |  { boolean?: never; date?: never;   /** A single entity reference. */
  entityReference: GraphqlEntityReferenceInput; link?: never; multiEntityReference?: never; multiLink?: never; multiSelectOption?: never; number?: never; selectOption?: never; string?: never; }
  |  { boolean?: never; date?: never; entityReference?: never;   /** A single URL value. */
  link: string; multiEntityReference?: never; multiLink?: never; multiSelectOption?: never; number?: never; selectOption?: never; string?: never; }
  |  { boolean?: never; date?: never; entityReference?: never; link?: never;   /** Multiple entity references. */
  multiEntityReference: Array<GraphqlEntityReferenceInput>; multiLink?: never; multiSelectOption?: never; number?: never; selectOption?: never; string?: never; }
  |  { boolean?: never; date?: never; entityReference?: never; link?: never; multiEntityReference?: never;   /** Multiple URL values. */
  multiLink: Array<string>; multiSelectOption?: never; number?: never; selectOption?: never; string?: never; }
  |  { boolean?: never; date?: never; entityReference?: never; link?: never; multiEntityReference?: never; multiLink?: never;   /** Multiple selected option identifiers. */
  multiSelectOption: Array<string | number>; number?: never; selectOption?: never; string?: never; }
  |  { boolean?: never; date?: never; entityReference?: never; link?: never; multiEntityReference?: never; multiLink?: never; multiSelectOption?: never;   /** A numeric value. */
  number: number; selectOption?: never; string?: never; }
  |  { boolean?: never; date?: never; entityReference?: never; link?: never; multiEntityReference?: never; multiLink?: never; multiSelectOption?: never; number?: never;   /** A single selected option identifier. */
  selectOption: string | number; string?: never; }
  |  { boolean?: never; date?: never; entityReference?: never; link?: never; multiEntityReference?: never; multiLink?: never; multiSelectOption?: never; number?: never; selectOption?: never;   /** A string value. */
  string: string; };

/** GraphQL input representing the shared email filter. */
export type GraphqlSharedEmailFilter =
  /** The exclude option. */
  | 'EXCLUDE'
  /** The include option. */
  | 'INCLUDE'
  /** The only option. */
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
  /** CRM contact entity. */
  | 'CRM_CONTACT'
  /** Document entity. */
  | 'DOCUMENT'
  /** Email thread entity. */
  | 'EMAIL_THREAD'
  /** Foreign entity. */
  | 'FOREIGN_ENTITY'
  /** Project entity. */
  | 'PROJECT'
  /** Static file entity. */
  | 'STATIC_FILE'
  /** Team entity. */
  | 'TEAM'
  /** User entity. */
  | 'USER';

/** Input for continuing a single grouped Soup bin. */
export type GroupedSoupContinuationInput = {
  /** Opaque cursor returned for the bin by a previous grouped query. */
  cursor: string;
  /** The field used to divide Soup items into bins. */
  groupBy: GraphqlGroupByInput;
  /** The grouping key of the bin to continue. */
  groupKey: string;
};

/** Input for starting a grouped Soup query. */
export type GroupedSoupInitialInput = {
  /** AST-shaped filters applied to each Soup entity type. */
  filters?: GraphqlEntityFilterAst | null | undefined;
  /** The field used to divide Soup items into bins. */
  groupBy: GraphqlGroupByInput;
  /** Maximum number of items to return per bin. Defaults to 20, max 500. */
  limit?: number | null | undefined;
  /** Sort order within each bin. Defaults to `VIEWED_UPDATED`. */
  sortMethod?: GraphqlSimpleSortMethod | null | undefined;
};

/** Input for `Query.groupSoup`. */
export type GroupedSoupInput =
  {   /** Continue one bin from a cursor returned by a previous grouped query. */
  continuation: GroupedSoupContinuationInput; initial?: never; }
  |  { continuation?: never;   /** Start a new grouped Soup query. */
  initial: GroupedSoupInitialInput; };

/** Input for assigning or updating an entity property. */
export type SetEntityPropertyInput = {
  /** Identifier of the entity receiving the property. */
  entityId: string;
  /** Type of entity receiving the property. */
  entityType: GraphqlPropertyTargetEntityType;
  /** Identifier of the property definition to assign. */
  propertyDefinitionId: string | number;
  /** Omit or pass null to attach the property without a value. */
  value?: GraphqlSetPropertyValue | null | undefined;
};

/** Input for continuing a Soup query. */
export type SoupContinuationInput = {
  /** Opaque cursor returned by a previous GraphQL Soup response. */
  cursor: string;
  /** Email preview view used when hydrating email Soup items. */
  emailView?: GraphqlEmailView | null | undefined;
  /** Whether to return expanded Soup items. Defaults to true. */
  expand?: boolean | null | undefined;
};

/** Input for starting a Soup query. */
export type SoupInitialInput = {
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

/** Input for `Query.soup`. */
export type SoupInput =
  {   /** Continue a Soup query from an opaque cursor. */
  continuation: SoupContinuationInput; initial?: never; }
  |  { continuation?: never;   /** Start a new Soup query. */
  initial: SoupInitialInput; };

export type GroupSoupMembershipQueryVariables = Exact<{
  input: GroupedSoupInput;
}>;


export type GroupSoupMembershipQuery = { user: { id: string, groupSoup: { bins: Array<{ key: string, totalCount: number, nextCursor: string | null, items: Array<{ id: string }> }> } } };

export type GroupSoupQueryVariables = Exact<{
  input: GroupedSoupInput;
}>;


export type GroupSoupQuery = { user: { id: string, groupSoup: { bins: Array<{ key: string, totalCount: number, nextCursor: string | null, items: Array<{ id: string, entityType: GraphqlSoupEntityType, frecencyScore: number, entity:
            | { __typename: 'GraphqlSoupCall', id: string, channelId: string, channelName: string | null, createdBy: string, customName: string | null, summary: string | null, startedAt: string, endedAt: string | null, durationMs: number | null, isActive: boolean, status: string, attended: boolean, participants: Array<{ userId: string, joinedAt: string, leftAt: string | null }>, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                  | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                  | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                  | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                  | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                  | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                  | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                  | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
                 | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
            | { __typename: 'GraphqlSoupChannel', id: string, channelType: string, ownerId: string, organizationId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, interactedAt: string | null, isParticipant: boolean, channelName: string | null, channelTeamId: string | null, participants: Array<{ channelId: string, userId: string, role: string, joinedAt: string, leftAt: string | null }>, latestMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, latestNonThreadMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
            | { __typename: 'GraphqlSoupChannelThread', id: string, channelId: string, senderId: string, content: string, createdAt: string, updatedAt: string, effectiveUpdatedAt: string, replyCount: number, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
            | { __typename: 'GraphqlSoupChat', id: string, ownerId: string, projectId: string | null, isPersistent: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, chatName: string, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                  | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                  | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                  | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                  | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                  | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                  | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                  | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
                 | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
            | { __typename: 'GraphqlSoupCrmCompany', id: string, description: string | null, emailSync: boolean, hidden: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, domains: Array<string>, crmTeamId: string, crmCompanyName: string | null, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                  | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                  | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                  | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                  | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                  | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                  | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                  | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
                 | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
            | { __typename: 'GraphqlSoupDocument', id: string, ownerId: string, fileType: string | null, projectId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, documentName: string, subType: { kind: string, isCompleted: boolean | null } | null, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                  | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                  | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                  | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                  | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                  | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                  | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                  | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
                 | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
            | { __typename: 'GraphqlSoupEmailThread', id: string, providerId: string | null, ownerId: string, inboxVisible: boolean, linkId: string | null, snippet: string | null, senderEmail: string | null, senderName: string | null, senderPhotoUrl: string | null, isRead: boolean, isDraft: boolean, isImportant: boolean, projectId: string | null, sortTs: string, createdAt: string, updatedAt: string, viewedAt: string | null, emailName: string | null, participants: Array<{ id: string, linkId: string, name: string | null, email: string | null, sfsPhotoUrl: string | null }>, attachments: Array<{ id: string, messageId: string, providerAttachmentId: string | null, filename: string | null, mimeType: string | null, sizeBytes: number | null, contentId: string | null, createdAt: string }>, labels: Array<{ id: string, linkId: string, providerLabelId: string, name: string, createdAt: string, messageListVisibility: string, labelListVisibility: string, type: string }>, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                  | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                  | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                  | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                  | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                  | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                  | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                  | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
                 | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }>, latestContentMessage: { __typename: 'GraphqlSoupEmailMessage', id: string, threadId: string, linkId: string, subject: string | null, snippet: string | null, internalDateTs: string | null, sentAt: string | null, isRead: boolean, isStarred: boolean, isSent: boolean, hasAttachments: boolean, bodyParsed: string | null, bodyText: string | null, bodyHtmlSanitized: string | null, bodyMacro: string | null, bodyReplyless: string | null, createdAt: string, updatedAt: string, from: { email: string, name: string | null, photoUrl: string | null } | null, to: Array<{ email: string, name: string | null, photoUrl: string | null }>, cc: Array<{ email: string, name: string | null, photoUrl: string | null }>, bcc: Array<{ email: string, name: string | null, photoUrl: string | null }>, labels: Array<{ providerLabelId: string, name: string }> } | null }
            | { __typename: 'GraphqlSoupForeignEntity', id: string, foreignEntityId: string, foreignEntitySource: string, storedForId: string, storedForAuthEntity: string, metadata: unknown, createdAt: string, updatedAt: string, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
            | { __typename: 'GraphqlSoupProject', id: string, ownerId: string, parentId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, projectName: string, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                  | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                  | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                  | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                  | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                  | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                  | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                  | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
                 | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
           }> }> } } };

export type QuickAccessSoupItemFieldsFragment = { id: string, entityType: GraphqlSoupEntityType, frecencyScore: number, entity:
    | { __typename: 'GraphqlSoupCall', id: string, channelId: string, channelName: string | null, createdBy: string, customName: string | null, summary: string | null, startedAt: string, endedAt: string | null, durationMs: number | null, isActive: boolean, status: string, attended: boolean, participants: Array<{ userId: string, joinedAt: string, leftAt: string | null }>, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupChannel', id: string, channelType: string, ownerId: string, organizationId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, interactedAt: string | null, channelName: string | null, channelTeamId: string | null, participants: Array<{ channelId: string, userId: string, role: string, joinedAt: string, leftAt: string | null }>, latestMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, latestNonThreadMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupChannelThread', id: string, channelId: string, senderId: string, content: string, createdAt: string, updatedAt: string, effectiveUpdatedAt: string, replyCount: number, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupChat', id: string, ownerId: string, projectId: string | null, isPersistent: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, chatName: string, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupCrmCompany', id: string, description: string | null, emailSync: boolean, hidden: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, domains: Array<string>, crmTeamId: string, crmCompanyName: string | null, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupDocument', id: string, ownerId: string, fileType: string | null, projectId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, documentName: string, subType: { kind: string, isCompleted: boolean | null } | null, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupEmailThread', attachmentCount: number, participantCount: number }
    | { __typename: 'GraphqlSoupForeignEntity', id: string, foreignEntityId: string, foreignEntitySource: string, storedForId: string, storedForAuthEntity: string, metadata: unknown, createdAt: string, updatedAt: string, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupProject', id: string, ownerId: string, parentId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, projectName: string, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
   };

export type SetEntityPropertyMutationVariables = Exact<{
  input: SetEntityPropertyInput;
}>;


export type SetEntityPropertyMutation = { setEntityProperty: { id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
      | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
      | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
      | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
      | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
      | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
      | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
      | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
     | null } };

export type SoupQueryVariables = Exact<{
  input: SoupInput;
}>;


export type SoupQuery = { user: { id: string, soup: { nextCursor: string | null, hasMore: boolean, items: Array<{ id: string, entityType: GraphqlSoupEntityType, frecencyScore: number, entity:
          | { __typename: 'GraphqlSoupCall', id: string, channelId: string, channelName: string | null, createdBy: string, customName: string | null, summary: string | null, startedAt: string, endedAt: string | null, durationMs: number | null, isActive: boolean, status: string, attended: boolean, participants: Array<{ userId: string, joinedAt: string, leftAt: string | null }>, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
               | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
          | { __typename: 'GraphqlSoupChannel', id: string, channelType: string, ownerId: string, organizationId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, interactedAt: string | null, isParticipant: boolean, channelName: string | null, channelTeamId: string | null, participants: Array<{ channelId: string, userId: string, role: string, joinedAt: string, leftAt: string | null }>, latestMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, latestNonThreadMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
          | { __typename: 'GraphqlSoupChannelThread', id: string, channelId: string, senderId: string, content: string, createdAt: string, updatedAt: string, effectiveUpdatedAt: string, replyCount: number, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
          | { __typename: 'GraphqlSoupChat', id: string, ownerId: string, projectId: string | null, isPersistent: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, chatName: string, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
               | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
          | { __typename: 'GraphqlSoupCrmCompany', id: string, description: string | null, emailSync: boolean, hidden: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, domains: Array<string>, crmTeamId: string, crmCompanyName: string | null, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
               | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
          | { __typename: 'GraphqlSoupDocument', id: string, ownerId: string, fileType: string | null, projectId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, documentName: string, subType: { kind: string, isCompleted: boolean | null } | null, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
               | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
          | { __typename: 'GraphqlSoupEmailThread', id: string, providerId: string | null, ownerId: string, inboxVisible: boolean, linkId: string | null, snippet: string | null, senderEmail: string | null, senderName: string | null, senderPhotoUrl: string | null, isRead: boolean, isDraft: boolean, isImportant: boolean, projectId: string | null, sortTs: string, createdAt: string, updatedAt: string, viewedAt: string | null, emailName: string | null, participants: Array<{ id: string, linkId: string, name: string | null, email: string | null, sfsPhotoUrl: string | null }>, attachments: Array<{ id: string, messageId: string, providerAttachmentId: string | null, filename: string | null, mimeType: string | null, sizeBytes: number | null, contentId: string | null, createdAt: string }>, labels: Array<{ id: string, linkId: string, providerLabelId: string, name: string, createdAt: string, messageListVisibility: string, labelListVisibility: string, type: string }>, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
               | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }>, latestContentMessage: { __typename: 'GraphqlSoupEmailMessage', id: string, threadId: string, linkId: string, subject: string | null, snippet: string | null, internalDateTs: string | null, sentAt: string | null, isRead: boolean, isStarred: boolean, isSent: boolean, hasAttachments: boolean, bodyParsed: string | null, bodyText: string | null, bodyHtmlSanitized: string | null, bodyMacro: string | null, bodyReplyless: string | null, createdAt: string, updatedAt: string, from: { email: string, name: string | null, photoUrl: string | null } | null, to: Array<{ email: string, name: string | null, photoUrl: string | null }>, cc: Array<{ email: string, name: string | null, photoUrl: string | null }>, bcc: Array<{ email: string, name: string | null, photoUrl: string | null }>, labels: Array<{ providerLabelId: string, name: string }> } | null }
          | { __typename: 'GraphqlSoupForeignEntity', id: string, foreignEntityId: string, foreignEntitySource: string, storedForId: string, storedForAuthEntity: string, metadata: unknown, createdAt: string, updatedAt: string, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
          | { __typename: 'GraphqlSoupProject', id: string, ownerId: string, parentId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, projectName: string, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
                | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
                | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
                | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
                | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
                | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
                | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
                | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
               | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
         }> } } };

export type SoupItemFieldsFragment = { id: string, entityType: GraphqlSoupEntityType, frecencyScore: number, entity:
    | { __typename: 'GraphqlSoupCall', id: string, channelId: string, channelName: string | null, createdBy: string, customName: string | null, summary: string | null, startedAt: string, endedAt: string | null, durationMs: number | null, isActive: boolean, status: string, attended: boolean, participants: Array<{ userId: string, joinedAt: string, leftAt: string | null }>, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupChannel', id: string, channelType: string, ownerId: string, organizationId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, interactedAt: string | null, isParticipant: boolean, channelName: string | null, channelTeamId: string | null, participants: Array<{ channelId: string, userId: string, role: string, joinedAt: string, leftAt: string | null }>, latestMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, latestNonThreadMessage: { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> } | null, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupChannelThread', id: string, channelId: string, senderId: string, content: string, createdAt: string, updatedAt: string, effectiveUpdatedAt: string, replyCount: number, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupChat', id: string, ownerId: string, projectId: string | null, isPersistent: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, chatName: string, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupCrmCompany', id: string, description: string | null, emailSync: boolean, hidden: boolean, createdAt: string, updatedAt: string, viewedAt: string | null, domains: Array<string>, crmTeamId: string, crmCompanyName: string | null, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupDocument', id: string, ownerId: string, fileType: string | null, projectId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, documentName: string, subType: { kind: string, isCompleted: boolean | null } | null, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupEmailThread', id: string, providerId: string | null, ownerId: string, inboxVisible: boolean, linkId: string | null, snippet: string | null, senderEmail: string | null, senderName: string | null, senderPhotoUrl: string | null, isRead: boolean, isDraft: boolean, isImportant: boolean, projectId: string | null, sortTs: string, createdAt: string, updatedAt: string, viewedAt: string | null, emailName: string | null, participants: Array<{ id: string, linkId: string, name: string | null, email: string | null, sfsPhotoUrl: string | null }>, attachments: Array<{ id: string, messageId: string, providerAttachmentId: string | null, filename: string | null, mimeType: string | null, sizeBytes: number | null, contentId: string | null, createdAt: string }>, labels: Array<{ id: string, linkId: string, providerLabelId: string, name: string, createdAt: string, messageListVisibility: string, labelListVisibility: string, type: string }>, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }>, latestContentMessage: { __typename: 'GraphqlSoupEmailMessage', id: string, threadId: string, linkId: string, subject: string | null, snippet: string | null, internalDateTs: string | null, sentAt: string | null, isRead: boolean, isStarred: boolean, isSent: boolean, hasAttachments: boolean, bodyParsed: string | null, bodyText: string | null, bodyHtmlSanitized: string | null, bodyMacro: string | null, bodyReplyless: string | null, createdAt: string, updatedAt: string, from: { email: string, name: string | null, photoUrl: string | null } | null, to: Array<{ email: string, name: string | null, photoUrl: string | null }>, cc: Array<{ email: string, name: string | null, photoUrl: string | null }>, bcc: Array<{ email: string, name: string | null, photoUrl: string | null }>, labels: Array<{ providerLabelId: string, name: string }> } | null }
    | { __typename: 'GraphqlSoupForeignEntity', id: string, foreignEntityId: string, foreignEntitySource: string, storedForId: string, storedForAuthEntity: string, metadata: unknown, createdAt: string, updatedAt: string, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
    | { __typename: 'GraphqlSoupProject', id: string, ownerId: string, parentId: string | null, createdAt: string, updatedAt: string, viewedAt: string | null, deletedAt: string | null, projectName: string, properties: Array<{ id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
          | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
          | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
          | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
          | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
          | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
          | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
          | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
         | null }>, notifications: Array<{ id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown }> }
   };

export type SoupPropertyFieldsFragment = { id: string, propertyDefinitionId: string, displayName: string, dataType: GraphqlPropertyDataType, isMultiSelect: boolean, specificEntityType: GraphqlPropertyEntityType | null, isSystem: boolean, isMetadata: boolean, value:
    | { __typename: 'GraphqlBooleanPropertyValue', boolValue: boolean }
    | { __typename: 'GraphqlDatePropertyValue', dateValue: string }
    | { __typename: 'GraphqlEntityReferencePropertyValue', references: Array<{ entityId: string, entityType: GraphqlPropertyEntityType, specificMessageId: string | null }> }
    | { __typename: 'GraphqlLinkPropertyValue', urls: Array<string> }
    | { __typename: 'GraphqlNumberPropertyValue', numberValue: number }
    | { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: Array<string> }
    | { __typename: 'GraphqlStringPropertyValue', stringValue: string }
   | null };

export type SoupChannelMessageFieldsFragment = { id: string, threadId: string | null, senderId: string, content: string, createdAt: string, updatedAt: string, deletedAt: string | null, mentions: Array<string> };

export type SoupNotificationFieldsFragment = { id: string, eventType: string, entityType: GraphqlSoupEntityType, entityId: string, sent: boolean, done: boolean, seen: boolean, createdAt: string, viewedAt: string | null, updatedAt: string, senderId: string | null, metadata: unknown };

export const SoupPropertyFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupPropertyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlProperty"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"propertyDefinitionId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}},{"kind":"Field","name":{"kind":"Name","value":"isMultiSelect"}},{"kind":"Field","name":{"kind":"Name","value":"specificEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"isMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"value"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlBooleanPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"boolValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlNumberPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"numberValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlStringPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"stringValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlDatePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"dateValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSelectOptionPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"optionIds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlEntityReferencePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"references"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"specificMessageId"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlLinkPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"urls"}}]}}]}}]}}]} as unknown as DocumentNode<SoupPropertyFieldsFragment, unknown>;
export const SoupNotificationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupNotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"sent"}},{"kind":"Field","name":{"kind":"Name","value":"done"}},{"kind":"Field","name":{"kind":"Name","value":"seen"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}}]}}]} as unknown as DocumentNode<SoupNotificationFieldsFragment, unknown>;
export const SoupChannelMessageFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupChannelMessageFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelMessage"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mentions"}}]}}]} as unknown as DocumentNode<SoupChannelMessageFieldsFragment, unknown>;
export const QuickAccessSoupItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"QuickAccessSoupItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"frecencyScore"}},{"kind":"Field","name":{"kind":"Name","value":"entity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupDocument"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"documentName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"fileType"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"subType"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"isCompleted"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"chatName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"isPersistent"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupProject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"projectName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupEmailThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"attachmentCount"}},{"kind":"Field","name":{"kind":"Name","value":"participantCount"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"channelName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"channelType"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"organizationId"}},{"kind":"Field","alias":{"kind":"Name","value":"channelTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"interactedAt"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestNonThreadMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"effectiveUpdatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"replyCount"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"channelName"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"customName"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"attended"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCrmCompany"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"crmTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","alias":{"kind":"Name","value":"crmCompanyName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"emailSync"}},{"kind":"Field","name":{"kind":"Name","value":"hidden"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupForeignEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntitySource"}},{"kind":"Field","name":{"kind":"Name","value":"storedForId"}},{"kind":"Field","name":{"kind":"Name","value":"storedForAuthEntity"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupPropertyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlProperty"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"propertyDefinitionId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}},{"kind":"Field","name":{"kind":"Name","value":"isMultiSelect"}},{"kind":"Field","name":{"kind":"Name","value":"specificEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"isMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"value"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlBooleanPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"boolValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlNumberPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"numberValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlStringPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"stringValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlDatePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"dateValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSelectOptionPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"optionIds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlEntityReferencePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"references"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"specificMessageId"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlLinkPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"urls"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupNotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"sent"}},{"kind":"Field","name":{"kind":"Name","value":"done"}},{"kind":"Field","name":{"kind":"Name","value":"seen"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupChannelMessageFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelMessage"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mentions"}}]}}]} as unknown as DocumentNode<QuickAccessSoupItemFieldsFragment, unknown>;
export const SoupItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"frecencyScore"}},{"kind":"Field","name":{"kind":"Name","value":"entity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupDocument"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"documentName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"fileType"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"subType"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"isCompleted"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"chatName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"isPersistent"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupProject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"projectName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupEmailThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"providerId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"inboxVisible"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","alias":{"kind":"Name","value":"emailName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"snippet"}},{"kind":"Field","name":{"kind":"Name","value":"senderEmail"}},{"kind":"Field","name":{"kind":"Name","value":"senderName"}},{"kind":"Field","name":{"kind":"Name","value":"senderPhotoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"isDraft"}},{"kind":"Field","name":{"kind":"Name","value":"isImportant"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"sortTs"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"sfsPhotoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"attachments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"messageId"}},{"kind":"Field","name":{"kind":"Name","value":"providerAttachmentId"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"mimeType"}},{"kind":"Field","name":{"kind":"Name","value":"sizeBytes"}},{"kind":"Field","name":{"kind":"Name","value":"contentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"labels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"providerLabelId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"messageListVisibility"}},{"kind":"Field","name":{"kind":"Name","value":"labelListVisibility"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestContentMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"subject"}},{"kind":"Field","name":{"kind":"Name","value":"snippet"}},{"kind":"Field","name":{"kind":"Name","value":"internalDateTs"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"isStarred"}},{"kind":"Field","name":{"kind":"Name","value":"isSent"}},{"kind":"Field","name":{"kind":"Name","value":"hasAttachments"}},{"kind":"Field","name":{"kind":"Name","value":"from"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"to"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cc"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bcc"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"labels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providerLabelId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bodyParsed"}},{"kind":"Field","name":{"kind":"Name","value":"bodyText"}},{"kind":"Field","name":{"kind":"Name","value":"bodyHtmlSanitized"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMacro"}},{"kind":"Field","name":{"kind":"Name","value":"bodyReplyless"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"channelName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"channelType"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"organizationId"}},{"kind":"Field","alias":{"kind":"Name","value":"channelTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"interactedAt"}},{"kind":"Field","name":{"kind":"Name","value":"isParticipant"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestNonThreadMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"effectiveUpdatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"replyCount"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"channelName"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"customName"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"attended"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCrmCompany"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"crmTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","alias":{"kind":"Name","value":"crmCompanyName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"emailSync"}},{"kind":"Field","name":{"kind":"Name","value":"hidden"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupForeignEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntitySource"}},{"kind":"Field","name":{"kind":"Name","value":"storedForId"}},{"kind":"Field","name":{"kind":"Name","value":"storedForAuthEntity"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupPropertyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlProperty"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"propertyDefinitionId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}},{"kind":"Field","name":{"kind":"Name","value":"isMultiSelect"}},{"kind":"Field","name":{"kind":"Name","value":"specificEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"isMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"value"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlBooleanPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"boolValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlNumberPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"numberValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlStringPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"stringValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlDatePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"dateValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSelectOptionPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"optionIds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlEntityReferencePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"references"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"specificMessageId"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlLinkPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"urls"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupNotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"sent"}},{"kind":"Field","name":{"kind":"Name","value":"done"}},{"kind":"Field","name":{"kind":"Name","value":"seen"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupChannelMessageFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelMessage"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mentions"}}]}}]} as unknown as DocumentNode<SoupItemFieldsFragment, unknown>;
export const GroupSoupMembershipDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GroupSoupMembership"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"GroupedSoupInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"groupSoup"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bins"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"nextCursor"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<GroupSoupMembershipQuery, GroupSoupMembershipQueryVariables>;
export const GroupSoupDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GroupSoup"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"GroupedSoupInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"groupSoup"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bins"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"nextCursor"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupItemFields"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupPropertyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlProperty"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"propertyDefinitionId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}},{"kind":"Field","name":{"kind":"Name","value":"isMultiSelect"}},{"kind":"Field","name":{"kind":"Name","value":"specificEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"isMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"value"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlBooleanPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"boolValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlNumberPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"numberValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlStringPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"stringValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlDatePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"dateValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSelectOptionPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"optionIds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlEntityReferencePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"references"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"specificMessageId"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlLinkPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"urls"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupNotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"sent"}},{"kind":"Field","name":{"kind":"Name","value":"done"}},{"kind":"Field","name":{"kind":"Name","value":"seen"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupChannelMessageFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelMessage"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mentions"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"frecencyScore"}},{"kind":"Field","name":{"kind":"Name","value":"entity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupDocument"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"documentName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"fileType"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"subType"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"isCompleted"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"chatName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"isPersistent"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupProject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"projectName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupEmailThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"providerId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"inboxVisible"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","alias":{"kind":"Name","value":"emailName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"snippet"}},{"kind":"Field","name":{"kind":"Name","value":"senderEmail"}},{"kind":"Field","name":{"kind":"Name","value":"senderName"}},{"kind":"Field","name":{"kind":"Name","value":"senderPhotoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"isDraft"}},{"kind":"Field","name":{"kind":"Name","value":"isImportant"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"sortTs"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"sfsPhotoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"attachments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"messageId"}},{"kind":"Field","name":{"kind":"Name","value":"providerAttachmentId"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"mimeType"}},{"kind":"Field","name":{"kind":"Name","value":"sizeBytes"}},{"kind":"Field","name":{"kind":"Name","value":"contentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"labels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"providerLabelId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"messageListVisibility"}},{"kind":"Field","name":{"kind":"Name","value":"labelListVisibility"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestContentMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"subject"}},{"kind":"Field","name":{"kind":"Name","value":"snippet"}},{"kind":"Field","name":{"kind":"Name","value":"internalDateTs"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"isStarred"}},{"kind":"Field","name":{"kind":"Name","value":"isSent"}},{"kind":"Field","name":{"kind":"Name","value":"hasAttachments"}},{"kind":"Field","name":{"kind":"Name","value":"from"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"to"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cc"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bcc"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"labels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providerLabelId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bodyParsed"}},{"kind":"Field","name":{"kind":"Name","value":"bodyText"}},{"kind":"Field","name":{"kind":"Name","value":"bodyHtmlSanitized"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMacro"}},{"kind":"Field","name":{"kind":"Name","value":"bodyReplyless"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"channelName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"channelType"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"organizationId"}},{"kind":"Field","alias":{"kind":"Name","value":"channelTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"interactedAt"}},{"kind":"Field","name":{"kind":"Name","value":"isParticipant"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestNonThreadMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"effectiveUpdatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"replyCount"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"channelName"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"customName"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"attended"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCrmCompany"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"crmTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","alias":{"kind":"Name","value":"crmCompanyName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"emailSync"}},{"kind":"Field","name":{"kind":"Name","value":"hidden"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupForeignEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntitySource"}},{"kind":"Field","name":{"kind":"Name","value":"storedForId"}},{"kind":"Field","name":{"kind":"Name","value":"storedForAuthEntity"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}}]}}]}}]} as unknown as DocumentNode<GroupSoupQuery, GroupSoupQueryVariables>;
export const SetEntityPropertyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetEntityProperty"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetEntityPropertyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setEntityProperty"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupPropertyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlProperty"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"propertyDefinitionId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}},{"kind":"Field","name":{"kind":"Name","value":"isMultiSelect"}},{"kind":"Field","name":{"kind":"Name","value":"specificEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"isMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"value"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlBooleanPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"boolValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlNumberPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"numberValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlStringPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"stringValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlDatePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"dateValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSelectOptionPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"optionIds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlEntityReferencePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"references"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"specificMessageId"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlLinkPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"urls"}}]}}]}}]}}]} as unknown as DocumentNode<SetEntityPropertyMutation, SetEntityPropertyMutationVariables>;
export const SoupDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Soup"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SoupInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"soup"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"nextCursor"}},{"kind":"Field","name":{"kind":"Name","value":"hasMore"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupPropertyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlProperty"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"propertyDefinitionId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}},{"kind":"Field","name":{"kind":"Name","value":"isMultiSelect"}},{"kind":"Field","name":{"kind":"Name","value":"specificEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"isMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"value"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlBooleanPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"boolValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlNumberPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"numberValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlStringPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"stringValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlDatePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"dateValue"},"name":{"kind":"Name","value":"value"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSelectOptionPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"optionIds"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlEntityReferencePropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"references"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"specificMessageId"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlLinkPropertyValue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"urls"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupNotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupNotification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"sent"}},{"kind":"Field","name":{"kind":"Name","value":"done"}},{"kind":"Field","name":{"kind":"Name","value":"seen"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupChannelMessageFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelMessage"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mentions"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SoupItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"frecencyScore"}},{"kind":"Field","name":{"kind":"Name","value":"entity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupDocument"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"documentName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"fileType"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"subType"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"isCompleted"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChat"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"chatName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"isPersistent"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupProject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"projectName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupEmailThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"providerId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"inboxVisible"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","alias":{"kind":"Name","value":"emailName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"snippet"}},{"kind":"Field","name":{"kind":"Name","value":"senderEmail"}},{"kind":"Field","name":{"kind":"Name","value":"senderName"}},{"kind":"Field","name":{"kind":"Name","value":"senderPhotoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"isDraft"}},{"kind":"Field","name":{"kind":"Name","value":"isImportant"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"sortTs"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"sfsPhotoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"attachments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"messageId"}},{"kind":"Field","name":{"kind":"Name","value":"providerAttachmentId"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"mimeType"}},{"kind":"Field","name":{"kind":"Name","value":"sizeBytes"}},{"kind":"Field","name":{"kind":"Name","value":"contentId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"labels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"providerLabelId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"messageListVisibility"}},{"kind":"Field","name":{"kind":"Name","value":"labelListVisibility"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestContentMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"linkId"}},{"kind":"Field","name":{"kind":"Name","value":"subject"}},{"kind":"Field","name":{"kind":"Name","value":"snippet"}},{"kind":"Field","name":{"kind":"Name","value":"internalDateTs"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"isStarred"}},{"kind":"Field","name":{"kind":"Name","value":"isSent"}},{"kind":"Field","name":{"kind":"Name","value":"hasAttachments"}},{"kind":"Field","name":{"kind":"Name","value":"from"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"to"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cc"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bcc"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"photoUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"labels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providerLabelId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bodyParsed"}},{"kind":"Field","name":{"kind":"Name","value":"bodyText"}},{"kind":"Field","name":{"kind":"Name","value":"bodyHtmlSanitized"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMacro"}},{"kind":"Field","name":{"kind":"Name","value":"bodyReplyless"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"channelName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"channelType"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"organizationId"}},{"kind":"Field","alias":{"kind":"Name","value":"channelTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"interactedAt"}},{"kind":"Field","name":{"kind":"Name","value":"isParticipant"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestNonThreadMessage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupChannelMessageFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupChannelThread"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"effectiveUpdatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"replyCount"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channelId"}},{"kind":"Field","name":{"kind":"Name","value":"channelName"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"customName"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"attended"}},{"kind":"Field","name":{"kind":"Name","value":"participants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"leftAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupCrmCompany"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","alias":{"kind":"Name","value":"crmTeamId"},"name":{"kind":"Name","value":"teamId"}},{"kind":"Field","alias":{"kind":"Name","value":"crmCompanyName"},"name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"emailSync"}},{"kind":"Field","name":{"kind":"Name","value":"hidden"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"viewedAt"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"properties"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupPropertyFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlSoupForeignEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"foreignEntitySource"}},{"kind":"Field","name":{"kind":"Name","value":"storedForId"}},{"kind":"Field","name":{"kind":"Name","value":"storedForAuthEntity"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SoupNotificationFields"}}]}}]}}]}}]}}]} as unknown as DocumentNode<SoupQuery, SoupQueryVariables>;