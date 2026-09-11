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
  notification?: 'done' | 'seen';
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
    documentSeen: {
      backend: 'ns',
      notification: 'seen',
      domain: [true, false],
    },
    documentDone: {
      backend: 'ns',
      notification: 'done',
      domain: [true, false],
    },
    documentImportance: { backend: 'imp', domain: [true, false] },
    isEmailAttachment: { backend: 'iea', domain: [true, false] },
    documentCreatedAt: { backend: 'ca', compile: 'dateRange' },
    documentUpdatedAt: { backend: 'ua', compile: 'dateRange' },
  },

  // calf — calendar events
  calf: {
    calendarEventId: { backend: 'id' },
    calendarEventSeen: {
      backend: 'ns',
      notification: 'seen',
      domain: [true, false],
    },
    calendarEventDone: {
      backend: 'ns',
      notification: 'done',
      domain: [true, false],
    },
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
    emailSeen: { backend: 'Read', domain: [true, false] },
    emailDone: {
      backend: 'NotificationState',
      notification: 'done',
      domain: [true, false],
    },
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
    channelSeen: {
      backend: 'NotificationState',
      notification: 'seen',
      domain: [true, false],
    },
    channelDone: {
      backend: 'NotificationState',
      notification: 'done',
      domain: [true, false],
    },
    channelImportance: { backend: 'Importance', domain: [true, false] },
    channelIsParticipant: { backend: 'IsParticipant', domain: [true, false] },
  },

  // cthf — channel threads
  cthf: {
    channelThreadChannelId: { backend: 'ChannelId' },
    channelThreadId: { backend: 'ThreadId' },
    channelThreadRootSenderId: { backend: 'RootSender' },
    channelThreadParticipantId: { backend: 'Participant' },
    channelThreadSeen: {
      backend: 'NotificationState',
      notification: 'seen',
      domain: [true, false],
    },
    channelThreadDone: {
      backend: 'NotificationState',
      notification: 'done',
      domain: [true, false],
    },
  },

  // cf — chats / agents
  cf: {
    chatId: { backend: 'cid' },
    chatOwnerId: { backend: 'o' },
    chatProjectId: { backend: 'pid' },
    chatSeen: { backend: 'ns', notification: 'seen', domain: [true, false] },
    chatDone: { backend: 'ns', notification: 'done', domain: [true, false] },
    chatCreatedAt: { backend: 'ca', compile: 'dateRange' },
    chatUpdatedAt: { backend: 'ua', compile: 'dateRange' },
  },

  // pf — folders / projects
  pf: {
    folderId: { backend: 'pid' },
    folderOwnerId: { backend: 'o' },
    folderSeen: { backend: 'ns', notification: 'seen', domain: [true, false] },
    folderDone: { backend: 'ns', notification: 'done', domain: [true, false] },
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
    foreignEntitySeen: {
      backend: 'ns',
      notification: 'seen',
      domain: [true, false],
    },
    foreignEntityDone: {
      backend: 'ns',
      notification: 'done',
      domain: [true, false],
    },
    foreignEntityIncludesMe: { backend: 'me', compile: 'unit' },
  },

  // ccf — crm companies
  ccf: {
    crmCompanyId: { backend: 'id' },
    crmCompanyHidden: { backend: 'hidden', domain: [true, false] },
  },

  asf: {
    agentSessionId: { backend: 'id' },
    agentSessionOwnerId: { backend: 'o' },
    includeAgentSessions: { backend: 'inc', compile: 'unit' },
  },

  // remf — reminders
  remf: {
    reminderId: { backend: 'id' },
    reminderCompleted: { backend: 'comp', domain: [true, false] },
    reminderFired: { backend: 'fired', domain: [true, false] },
    includeReminders: { backend: 'inc', compile: 'unit' },
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
    documentImportance: boolean;
    isEmailAttachment: boolean;
    documentCreatedAt: DateRangeFilter;
    documentUpdatedAt: DateRangeFilter;
  };

  // calf — calendar events
  calf: {
    calendarEventId: string[];
    calendarEventSeen: boolean;
    calendarEventDone: boolean;
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
    channelThreadSeen: boolean;
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

  asf: {
    agentSessionId: string[];
    agentSessionOwnerId: string[];
    includeAgentSessions: boolean;
  };

  // remf — reminders
  remf: {
    reminderId: string[];
    reminderCompleted: boolean;
    reminderFired: boolean;
    includeReminders: boolean;
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
  'calf',
  'ef',
  'chanf',
  'cthf',
  'cf',
  'pf',
  'callf',
  'fef',
  'ccf',
  'asf',
  'remf',
  'propf',
];

export type FieldsForTarget<T extends Target> = keyof FilterTargets[T] & string;

export type FieldKey = {
  [T in Target]: FieldsForTarget<T>;
}[Target];

export type EntityTarget = Exclude<Target, 'propf'>;

export const ENTITY_TARGETS: EntityTarget[] = [
  'df',
  'calf',
  'ef',
  'chanf',
  'cthf',
  'cf',
  'pf',
  'callf',
  'fef',
  'ccf',
  'asf',
  'remf',
];

export const ENTITY_ID_BACKENDS: Record<EntityTarget, string> = {
  df: 'id',
  calf: 'id',
  ef: 'ThreadId',
  chanf: 'ChannelId',
  cthf: 'ChannelId',
  cf: 'cid',
  pf: 'pid',
  callf: 'CallId',
  fef: 'id',
  ccf: 'id',
  asf: 'id',
  remf: 'id',
};

export const ENTITY_ID_FIELDS: Record<EntityTarget, string> = {
  df: 'documentId',
  calf: 'calendarEventId',
  ef: 'threadId',
  chanf: 'channelId',
  cthf: 'channelThreadChannelId',
  cf: 'chatId',
  pf: 'folderId',
  callf: 'callId',
  fef: 'foreignEntityRecordId',
  ccf: 'crmCompanyId',
  asf: 'agentSessionId',
  remf: 'reminderId',
};

export const NIL_ID = '00000000-0000-0000-0000-000000000000';
