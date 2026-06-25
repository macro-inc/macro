export type EmailView = 'inbox' | 'drafts' | 'sent' | 'all';

export type CallStatus = 'ATTENDED' | 'MISSED' | 'UNATTENDED';

export function callStatusFromAttended(
  attended: boolean | null | undefined
): CallStatus | undefined {
  if (attended === true) return 'ATTENDED';
  if (attended === false) return 'UNATTENDED';
  return undefined;
}

export type DateRangeFilter = {
  gt?: string;
  gte?: string;
  lt?: string;
  lte?: string;
};

export type PropertyFilter = {
  propertyId: string;
  type: 'select' | 'entity';
  value: string;
};

export type ArrayFieldFilters = {
  documentId?: string[];
  fileType?: string[];
  fileAssoc?: string[];
  subType?: string[];
  projectId?: string[];
  documentOwnerId?: string[];
  threadId?: string[];
  emailLinkId?: string[];
  emailProjectId?: string[];
  emailSender?: string[];
  channelId?: string[];
  channelType?: string[];
  channelSenderId?: string[];
  channelThreadId?: string[];
  chatId?: string[];
  chatOwnerId?: string[];
  chatProjectId?: string[];
  folderId?: string[];
  folderOwnerId?: string[];
  callId?: string[];
  callChannelId?: string[];
  callSpeakerId?: string[];
  foreignEntityRecordId?: string[];
  foreignEntitySource?: string[];
  crmCompanyId?: string[];
  properties?: PropertyFilter[];
};

export type ScalarFieldFilters = {
  documentSeen?: boolean;
  documentDone?: boolean;
  isEmailAttachment?: boolean;
  emailSeen?: boolean;
  emailDone?: boolean;
  emailImportance?: boolean;
  emailShared?: 'exclude' | 'include' | 'only';
  emailCalendarOnly?: boolean;
  channelSeen?: boolean;
  channelDone?: boolean;
  channelImportance?: boolean;
  chatSeen?: boolean;
  chatDone?: boolean;
  folderSeen?: boolean;
  folderDone?: boolean;
  foreignEntitySeen?: boolean;
  foreignEntityDone?: boolean;
  foreignEntityIncludesMe?: boolean;
  callStatus?: CallStatus;
  callAttended?: boolean;
  crmCompanyHidden?: boolean;
  documentCreatedAt?: DateRangeFilter;
  documentUpdatedAt?: DateRangeFilter;
  chatCreatedAt?: DateRangeFilter;
  chatUpdatedAt?: DateRangeFilter;
  folderCreatedAt?: DateRangeFilter;
  folderUpdatedAt?: DateRangeFilter;
  emailUpdatedAt?: DateRangeFilter;
};

export type FieldFilters = ArrayFieldFilters & ScalarFieldFilters;

export type FieldName = keyof FieldFilters;

export type DocumentFieldName =
  | 'documentId'
  | 'fileType'
  | 'fileAssoc'
  | 'subType'
  | 'projectId'
  | 'documentOwnerId'
  | 'documentSeen'
  | 'documentDone'
  | 'isEmailAttachment'
  | 'documentCreatedAt'
  | 'documentUpdatedAt';

export type DocumentFieldFilters = Pick<FieldFilters, DocumentFieldName>;

export type DocumentFilterClause = {
  include?: DocumentFieldFilters;
  exclude?: DocumentFieldFilters;
};

export type DocumentFilterExpression =
  | DocumentFilterClause
  | { op: 'and'; clauses: DocumentFilterExpression[] }
  | { op: 'or'; clauses: DocumentFilterExpression[] }
  | { op: 'not'; clause: DocumentFilterExpression };

export type QueryState = {
  include: FieldFilters;
  exclude: FieldFilters;
  documentWhere?: DocumentFilterExpression[];
  emailView?: EmailView;
};

export type Query = {
  include?: FieldFilters;
  exclude?: FieldFilters;
  documentWhere?: DocumentFilterExpression | DocumentFilterExpression[];
  emailView?: EmailView;
};
