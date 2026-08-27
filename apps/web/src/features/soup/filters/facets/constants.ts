export type CallStatus = 'ATTENDED' | 'MISSED' | 'UNATTENDED';

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

export type PropertyValue = { type: 'select' | 'entity'; value: string };

type FilterFieldCompileKind = 'value' | 'unit' | 'dateRange';

export type FilterFieldMeta = {
  backend: string;
  compile?: FilterFieldCompileKind;
  formatValue?: (value: unknown) => unknown;
  domain?: unknown[];
};

/*
 * When adding a filter, update FILTER_TARGETS and FilterTargetsMeta. New
 * targets also require TARGETS; entity targets additionally require
 * ENTITY_TARGETS, ENTITY_ID_BACKENDS, and ENTITY_ID_FIELDS.
 */
export const FILTER_TARGETS = {
  // df — documents / files / tasks
  df: {
    documentId: { backend: 'id' },
    documentProjectId: { backend: 'pid' },
    fileType: { backend: 'ft' },
    fileAssoc: { backend: 'fa' },
    subType: { backend: 'dst' },
    documentOwnerId: { backend: 'o' },
    documentSeen: { backend: 'ns', domain: [true, false] },
    documentDone: { backend: 'nd', domain: [true, false] },
    isEmailAttachment: { backend: 'iea', domain: [true, false] },
    documentCreatedAt: { backend: 'ca', compile: 'dateRange' },
    documentUpdatedAt: { backend: 'ua', compile: 'dateRange' },
  },

  // ef — email
  ef: {
    threadId: { backend: 'ThreadId' },
    emailLinkId: { backend: 'Owner' },
    emailProjectId: { backend: 'ProjectId' },
    emailSender: {
      backend: 'Sender',
      formatValue: (value) => ({ Partial: value }),
    },
    emailSeen: { backend: 'NotificationSeen', domain: [true, false] },
    emailDone: { backend: 'NotificationDone', domain: [true, false] },
    emailImportance: { backend: 'Importance', domain: [true, false] },
    emailShared: { backend: 'Shared' },
    emailCalendarOnly: { backend: 'CalendarOnly', domain: [true, false] },
    emailUpdatedAt: { backend: 'ua', compile: 'dateRange' },
  },

  // chanf — channels
  chanf: {
    channelId: { backend: 'ChannelId' },
    channelType: { backend: 'ChannelType' },
    channelSenderId: { backend: 'Sender' },
    channelSeen: { backend: 'NotificationSeen', domain: [true, false] },
    channelDone: { backend: 'NotificationDone', domain: [true, false] },
    channelImportance: { backend: 'Importance', domain: [true, false] },
    channelIsParticipant: { backend: 'IsParticipant', domain: [true, false] },
  },

  // cthf — channel threads
  cthf: {
    channelThreadChannelId: { backend: 'ChannelId' },
    channelThreadId: { backend: 'ThreadId' },
    channelThreadRootSenderId: { backend: 'RootSender' },
    channelThreadParticipantId: { backend: 'Participant' },
    channelThreadDone: { backend: 'NotificationDone', domain: [true, false] },
  },

  // cf — chats / agents
  cf: {
    chatId: { backend: 'cid' },
    chatOwnerId: { backend: 'o' },
    chatProjectId: { backend: 'pid' },
    chatSeen: { backend: 'ns', domain: [true, false] },
    chatDone: { backend: 'nd', domain: [true, false] },
    chatCreatedAt: { backend: 'ca', compile: 'dateRange' },
    chatUpdatedAt: { backend: 'ua', compile: 'dateRange' },
  },

  // pf — folders / projects
  pf: {
    folderId: { backend: 'pid' },
    folderOwnerId: { backend: 'o' },
    folderSeen: { backend: 'ns', domain: [true, false] },
    folderDone: { backend: 'nd', domain: [true, false] },
    folderCreatedAt: { backend: 'ca', compile: 'dateRange' },
    folderUpdatedAt: { backend: 'ua', compile: 'dateRange' },
    projectId: { backend: 'pid' },
  },

  // callf — calls
  callf: {
    callId: { backend: 'CallId' },
    callChannelId: { backend: 'ChannelId' },
    callSpeakerId: { backend: 'Speaker' },
    callStatus: { backend: 'Status' },
    callAttended: { backend: 'Attended', domain: [true, false] },
  },

  // fef — foreign entities
  fef: {
    foreignEntityRecordId: { backend: 'id' },
    foreignEntitySource: { backend: 'fes' },
    foreignEntitySeen: { backend: 'ns', domain: [true, false] },
    foreignEntityDone: { backend: 'nd', domain: [true, false] },
    foreignEntityIncludesMe: { backend: 'me', compile: 'unit' },
  },

  // ccf — crm companies
  ccf: {
    crmCompanyId: { backend: 'id' },
    crmCompanyHidden: { backend: 'hidden', domain: [true, false] },
  },

  // propf — properties
  propf: {
    properties: { backend: 'properties' },
  },
} satisfies Record<string, Record<string, FilterFieldMeta>>;

type FilterTargetsMeta = {
  // df — documents / files / tasks
  df: {
    documentId: string[];
    documentProjectId: string[];
    fileType: string[];
    fileAssoc: string[];
    subType: string[];
    documentOwnerId: string[];
    documentSeen: boolean;
    documentDone: boolean;
    isEmailAttachment: boolean;
    documentCreatedAt: DateRangeFilter;
    documentUpdatedAt: DateRangeFilter;
  };

  // ef — email
  ef: {
    threadId: string[];
    emailLinkId: string[];
    emailProjectId: string[];
    emailSender: string[];
    emailSeen: boolean;
    emailDone: boolean;
    emailImportance: boolean;
    emailShared: 'exclude' | 'include' | 'only';
    emailCalendarOnly: boolean;
    emailUpdatedAt: DateRangeFilter;
  };

  // chanf — channels
  chanf: {
    channelId: string[];
    channelType: string[];
    channelSenderId: string[];
    channelSeen: boolean;
    channelDone: boolean;
    channelImportance: boolean;
    channelIsParticipant: boolean;
  };

  // cthf — channel threads
  cthf: {
    channelThreadChannelId: string[];
    channelThreadId: string[];
    channelThreadRootSenderId: string[];
    channelThreadParticipantId: string[];
    channelThreadDone: boolean;
  };

  // cf — chats / agents
  cf: {
    chatId: string[];
    chatOwnerId: string[];
    chatProjectId: string[];
    chatSeen: boolean;
    chatDone: boolean;
    chatCreatedAt: DateRangeFilter;
    chatUpdatedAt: DateRangeFilter;
  };

  // pf — folders / projects
  pf: {
    folderId: string[];
    folderOwnerId: string[];
    folderSeen: boolean;
    folderDone: boolean;
    folderCreatedAt: DateRangeFilter;
    folderUpdatedAt: DateRangeFilter;
    projectId: string[];
  };

  // callf — calls
  callf: {
    callId: string[];
    callChannelId: string[];
    callSpeakerId: string[];
    callStatus: CallStatus;
    callAttended: boolean;
  };

  // fef — foreign entities
  fef: {
    foreignEntityRecordId: string[];
    foreignEntitySource: string[];
    foreignEntitySeen: boolean;
    foreignEntityDone: boolean;
    foreignEntityIncludesMe: boolean;
  };

  // ccf — crm companies
  ccf: {
    crmCompanyId: string[];
    crmCompanyHidden: boolean;
  };

  // propf — properties
  propf: {
    properties: PropertyFilter[];
  };
};

type FilterTargetsConfig = typeof FILTER_TARGETS;

export type FilterTargets = {
  [T in keyof FilterTargetsConfig]: {
    [K in keyof FilterTargetsConfig[T]]: T extends keyof FilterTargetsMeta
      ? K extends keyof FilterTargetsMeta[T]
        ? FilterTargetsMeta[T][K]
        : never
      : never;
  };
};

export type Target = keyof FilterTargets;

export const TARGETS: Target[] = [
  'df',
  'ef',
  'chanf',
  'cthf',
  'cf',
  'pf',
  'callf',
  'fef',
  'ccf',
  'propf',
];

export type FieldsForTarget<T extends Target> = keyof FilterTargets[T] & string;

export type FieldKey = {
  [T in Target]: FieldsForTarget<T>;
}[Target];

export type EntityTarget = Exclude<Target, 'propf'>;

export const ENTITY_TARGETS: EntityTarget[] = [
  'df',
  'ef',
  'chanf',
  'cthf',
  'cf',
  'pf',
  'callf',
  'fef',
  'ccf',
];

export const ENTITY_ID_BACKENDS: Record<EntityTarget, string> = {
  df: 'id',
  ef: 'ThreadId',
  chanf: 'ChannelId',
  cthf: 'ChannelId',
  cf: 'cid',
  pf: 'pid',
  callf: 'CallId',
  fef: 'id',
  ccf: 'id',
};

export const ENTITY_ID_FIELDS: Record<EntityTarget, string> = {
  df: 'documentId',
  ef: 'threadId',
  chanf: 'channelId',
  cthf: 'channelThreadChannelId',
  cf: 'chatId',
  pf: 'folderId',
  callf: 'callId',
  fef: 'foreignEntityRecordId',
  ccf: 'crmCompanyId',
};

export const NIL_ID = '00000000-0000-0000-0000-000000000000';
