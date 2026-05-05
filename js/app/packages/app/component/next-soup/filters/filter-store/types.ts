export type EmailView = 'inbox' | 'drafts' | 'sent' | 'all';

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
  emailProjectId?: string[];
  emailSender?: string[];
  channelId?: string[];
  channelType?: string[];
  channelSenderId?: string[];
  chatId?: string[];
  chatOwnerId?: string[];
  chatProjectId?: string[];
  folderId?: string[];
  folderOwnerId?: string[];
  callId?: string[];
  callChannelId?: string[];
  callSpeakerId?: string[];
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
  callAttended?: boolean;
};

export type FieldFilters = ArrayFieldFilters & ScalarFieldFilters;

export type FieldName = keyof FieldFilters;

export type QueryState = {
  include: FieldFilters;
  exclude: FieldFilters;
  emailView?: EmailView;
};

export type Query = {
  include?: FieldFilters;
  exclude?: FieldFilters;
  emailView?: EmailView;
};

export type FilterPredicate<T> = (entity: T, ctx?: unknown) => boolean;

export type FilterConfig<T, TId extends string = string> = {
  readonly id: TId;
  readonly predicate: FilterPredicate<T>;
  readonly query?: Query | ((ctx: unknown) => Query);
};

export type FilterStoreOptions<
  T,
  TFilter extends FilterConfig<T>,
  TId extends string = TFilter['id'],
> = {
  readonly filters: readonly TFilter[];
  readonly initialFilters?: {
    readonly and?: readonly TId[];
    readonly or?: readonly TId[];
  };
  readonly initialQuery?: Query;
};

export type FilterIdInput<TId extends string> = TId | (string & {});

export type SetFiltersInput<TId extends string> = {
  readonly and?: readonly FilterIdInput<TId>[];
  readonly or?: readonly FilterIdInput<TId>[];
};
