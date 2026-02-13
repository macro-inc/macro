import type { Property } from '@core/component/Properties/types';
import { applyDurationToDate } from '@core/util/dateSearch/dateParser';
import type {
  ChannelEntity,
  ChatEntity,
  DocumentEntity,
  EmailEntity,
  ProjectEntity,
  TaskEntity,
} from '../src/types/entity';
import type { Notification, WithNotification } from '../src/types/notification';
import type { WithSearch } from '../src/types/search';

export const MOCK_USER_IDS = {
  owner: 'macro|alex@example.com',
  sharedUser: 'macro|sam@example.com',
  teamMember1: 'macro|jordan@example.com',
  teamMember2: 'macro|casey@example.com',
  currentUser: 'macro|current@example.com',
} as const;

export const MOCK_USERS = [
  { id: MOCK_USER_IDS.owner, firstName: 'Alex', lastName: 'Owner' },
  { id: MOCK_USER_IDS.sharedUser, firstName: 'Sam', lastName: 'Shared' },
  { id: MOCK_USER_IDS.teamMember1, firstName: 'Jordan', lastName: 'Team' },
  { id: MOCK_USER_IDS.teamMember2, firstName: 'Casey', lastName: 'Member' },
  { id: MOCK_USER_IDS.currentUser, firstName: 'Current', lastName: 'User' },
] as const;

const now = new Date();
export const MOCK_TIMESTAMPS = {
  now,
  today: applyDurationToDate(now, { value: -30, unit: 'min' }),
  yesterday: applyDurationToDate(now, { value: -1, unit: 'd' }),
  lastWeek: applyDurationToDate(now, { value: -7, unit: 'd' }),
  lastMonth: applyDurationToDate(now, { value: -30, unit: 'd' }),
  lastYear: applyDurationToDate(now, { value: -365, unit: 'd' }),
} as const;

export const MOCK_PROPERTIES: Property[] = [
  {
    propertyId: 'prop_priority_1',
    propertyDefinitionId: 'def_priority',
    displayName: 'Priority',
    isMultiSelect: false,
    valueType: 'SELECT_STRING',
    value: ['opt_high'],
    options: [
      {
        id: 'opt_high',
        value: { type: 'string', value: 'High' },
        created_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        updated_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        property_definition_id: 'def_priority',
        display_order: 0,
      },
      {
        id: 'opt_medium',
        value: { type: 'string', value: 'Medium' },
        created_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        updated_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        property_definition_id: 'def_priority',
        display_order: 1,
      },
      {
        id: 'opt_low',
        value: { type: 'string', value: 'Low' },
        created_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        updated_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        property_definition_id: 'def_priority',
        display_order: 2,
      },
    ],
    owner: { scope: 'organization', organization_id: 1 },
    createdAt: MOCK_TIMESTAMPS.lastMonth,
    updatedAt: MOCK_TIMESTAMPS.today,
  },
  {
    propertyId: 'prop_status_1',
    propertyDefinitionId: 'def_status',
    displayName: 'Status',
    isMultiSelect: false,
    valueType: 'SELECT_STRING',
    value: ['opt_in_progress'],
    options: [
      {
        id: 'opt_todo',
        value: { type: 'string', value: 'To Do' },
        created_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        updated_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        property_definition_id: 'def_status',
        display_order: 0,
      },
      {
        id: 'opt_in_progress',
        value: { type: 'string', value: 'In Progress' },
        created_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        updated_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        property_definition_id: 'def_status',
        display_order: 1,
      },
      {
        id: 'opt_done',
        value: { type: 'string', value: 'Done' },
        created_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        updated_at: MOCK_TIMESTAMPS.lastMonth.toISOString(),
        property_definition_id: 'def_status',
        display_order: 2,
      },
    ],
    owner: { scope: 'organization', organization_id: 1 },
    createdAt: MOCK_TIMESTAMPS.lastMonth,
    updatedAt: MOCK_TIMESTAMPS.today,
  },
  {
    propertyId: 'prop_due_date_1',
    propertyDefinitionId: 'def_due_date',
    displayName: 'Due Date',
    isMultiSelect: false,
    valueType: 'DATE',
    value: applyDurationToDate(MOCK_TIMESTAMPS.now, { value: 7, unit: 'd' }), // 7 days from now
    owner: { scope: 'organization', organization_id: 1 },
    createdAt: MOCK_TIMESTAMPS.lastMonth,
    updatedAt: MOCK_TIMESTAMPS.today,
  },
];

export const createMockNotification = (
  overrides?: Partial<Notification>
): Notification => ({
  id: 'notif_123',
  done: false,
  sent: true,
  sender_id: MOCK_USER_IDS.teamMember1,
  notification_event_type: 'document_mention',
  entity_id: 'doc_123',
  entity_type: 'document',
  created_at: MOCK_TIMESTAMPS.today.toISOString(),
  updated_at: MOCK_TIMESTAMPS.today.toISOString(),
  deleted_at: null,
  viewed_at: null,
  notification_metadata: {
    tag: 'document_mention',
    content: { documentName: 'Test Document', owner: 'user_123' },
  },
  ...overrides,
});

export const MOCK_NOTIFICATIONS: Notification[] = [
  createMockNotification({
    id: 'notif_mention_1',
    notification_event_type: 'document_mention',
    sender_id: MOCK_USER_IDS.teamMember1,
    created_at: MOCK_TIMESTAMPS.today.toISOString(),
  }),
  createMockNotification({
    id: 'notif_task_1',
    notification_event_type: 'task_assigned',
    sender_id: MOCK_USER_IDS.teamMember2,
    created_at: MOCK_TIMESTAMPS.yesterday.toISOString(),
  }),
  createMockNotification({
    id: 'notif_channel_1',
    notification_event_type: 'channel_message_send',
    sender_id: MOCK_USER_IDS.sharedUser,
    created_at: MOCK_TIMESTAMPS.lastWeek.toISOString(),
    entity_type: 'channel',
  }),
];

export const MOCK_DOCUMENT_BASIC: DocumentEntity = {
  type: 'document',
  id: 'doc_basic_1',
  name: 'Meeting Notes',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  createdAt: MOCK_TIMESTAMPS.lastWeek,
  updatedAt: MOCK_TIMESTAMPS.yesterday,
  frecencyScore: 0.85,
};

export const MOCK_DOCUMENT_WITH_PROJECT: DocumentEntity = {
  type: 'document',
  id: 'doc_project_1',
  name: 'Project Roadmap Q1 2025',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  projectId: 'proj_1',
  createdAt: MOCK_TIMESTAMPS.lastMonth,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.92,
};

export const MOCK_DOCUMENT_PDF: DocumentEntity = {
  type: 'document',
  id: 'doc_pdf_1',
  name: 'Design Specifications.pdf',
  ownerId: MOCK_USER_IDS.sharedUser,
  fileType: 'pdf',
  createdAt: MOCK_TIMESTAMPS.lastMonth,
  updatedAt: MOCK_TIMESTAMPS.lastWeek,
  frecencyScore: 0.65,
};

export const MOCK_DOCUMENT_LONG_NAME: DocumentEntity = {
  type: 'document',
  id: 'doc_long_1',
  name: 'This is a very long document name that should test truncation behavior and how the UI handles overflow text in the entity component',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  createdAt: MOCK_TIMESTAMPS.lastYear,
  updatedAt: MOCK_TIMESTAMPS.lastMonth,
  frecencyScore: 0.45,
};

export const MOCK_DOCUMENT_SPECIAL_CHARS: DocumentEntity = {
  type: 'document',
  id: 'doc_special_1',
  name: 'Test [Document] with "Special" & <Characters>!',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  createdAt: MOCK_TIMESTAMPS.lastWeek,
  updatedAt: MOCK_TIMESTAMPS.yesterday,
  frecencyScore: 0.75,
};

export const MOCK_TASK_TODO: TaskEntity = {
  type: 'document',
  id: 'task_todo_1',
  name: 'Review Q1 Budget',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  subType: { type: 'task', is_completed: false },
  projectId: 'proj_1',
  createdAt: MOCK_TIMESTAMPS.lastWeek,
  updatedAt: MOCK_TIMESTAMPS.yesterday,
  frecencyScore: 0.88,
};

export const MOCK_TASK_COMPLETED: TaskEntity = {
  type: 'document',
  id: 'task_done_1',
  name: 'Setup CI/CD Pipeline',
  ownerId: MOCK_USER_IDS.currentUser,
  fileType: 'md',
  subType: { type: 'task', is_completed: true },
  projectId: 'proj_2',
  createdAt: MOCK_TIMESTAMPS.lastMonth,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.95,
};

export const MOCK_TASK_HIGH_PRIORITY: TaskEntity = {
  type: 'document',
  id: 'task_urgent_1',
  name: 'Fix Critical Security Bug',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  subType: { type: 'task', is_completed: false },
  createdAt: MOCK_TIMESTAMPS.today,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.99,
};

export const MOCK_CHANNEL_PUBLIC: ChannelEntity = {
  type: 'channel',
  id: 'channel_public_1',
  name: 'general',
  ownerId: MOCK_USER_IDS.owner,
  channelType: 'public',
  createdAt: MOCK_TIMESTAMPS.lastYear,
  updatedAt: MOCK_TIMESTAMPS.today,
  interactedAt: MOCK_TIMESTAMPS.today,
  latestMessage: {
    content: "Hey everyone! Don't forget about the team meeting at 2pm",
    senderId: MOCK_USER_IDS.teamMember1,
    createdAt: MOCK_TIMESTAMPS.today,
  },
  frecencyScore: 0.91,
};

export const MOCK_CHANNEL_PRIVATE: ChannelEntity = {
  type: 'channel',
  id: 'channel_private_1',
  name: 'design-team',
  ownerId: MOCK_USER_IDS.owner,
  channelType: 'private',
  createdAt: MOCK_TIMESTAMPS.lastMonth,
  updatedAt: MOCK_TIMESTAMPS.yesterday,
  interactedAt: MOCK_TIMESTAMPS.yesterday,
  latestMessage: {
    content: 'Updated the mockups in Figma',
    senderId: MOCK_USER_IDS.teamMember2,
    createdAt: MOCK_TIMESTAMPS.yesterday,
  },
  frecencyScore: 0.83,
};

export const MOCK_CHANNEL_DIRECT_MESSAGE: ChannelEntity = {
  type: 'channel',
  id: 'channel_dm_1',
  name: 'Direct Message',
  ownerId: MOCK_USER_IDS.currentUser,
  channelType: 'direct_message',
  participantIds: [MOCK_USER_IDS.currentUser, MOCK_USER_IDS.teamMember1],
  createdAt: MOCK_TIMESTAMPS.lastWeek,
  updatedAt: MOCK_TIMESTAMPS.today,
  interactedAt: MOCK_TIMESTAMPS.today,
  latestMessage: {
    content: 'Can you review the PR?',
    senderId: MOCK_USER_IDS.teamMember1,
    createdAt: MOCK_TIMESTAMPS.today,
  },
  frecencyScore: 0.87,
};

export const MOCK_CHANNEL_ORGANIZATION: ChannelEntity = {
  type: 'channel',
  id: 'channel_org_1',
  name: 'company-announcements',
  ownerId: MOCK_USER_IDS.owner,
  channelType: 'organization',
  createdAt: MOCK_TIMESTAMPS.lastYear,
  updatedAt: MOCK_TIMESTAMPS.lastWeek,
  interactedAt: MOCK_TIMESTAMPS.lastWeek,
  latestMessage: {
    content: 'Q4 results are in!',
    senderId: MOCK_USER_IDS.owner,
    createdAt: MOCK_TIMESTAMPS.lastWeek,
  },
  frecencyScore: 0.72,
};

export const MOCK_CHANNEL_EMPTY_MESSAGE: ChannelEntity = {
  type: 'channel',
  id: 'channel_attachment_1',
  name: 'project-files',
  ownerId: MOCK_USER_IDS.owner,
  channelType: 'private',
  createdAt: MOCK_TIMESTAMPS.lastMonth,
  updatedAt: MOCK_TIMESTAMPS.today,
  interactedAt: MOCK_TIMESTAMPS.today,
  latestMessage: {
    content: '',
    senderId: MOCK_USER_IDS.teamMember2,
    createdAt: MOCK_TIMESTAMPS.today,
  },
  frecencyScore: 0.68,
};

export const MOCK_EMAIL_UNREAD: EmailEntity = {
  type: 'email',
  id: 'email_unread_1',
  name: 'Q1 Planning Session',
  ownerId: MOCK_USER_IDS.currentUser,
  isRead: false,
  isDraft: false,
  isImportant: false,
  done: false,
  senderEmail: 'alice@example.com',
  senderName: 'Alice Johnson',
  snippet: "Let's schedule a meeting to discuss our Q1 goals and objectives...",
  participants: [
    { email: 'alice@example.com', name: 'Alice Johnson' },
    { email: 'bob@example.com', name: 'Bob Smith' },
  ],
  createdAt: MOCK_TIMESTAMPS.today,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.94,
};

export const MOCK_EMAIL_READ: EmailEntity = {
  type: 'email',
  id: 'email_read_1',
  name: 'Re: Project Update',
  ownerId: MOCK_USER_IDS.currentUser,
  isRead: true,
  isDraft: false,
  isImportant: false,
  done: true,
  senderEmail: 'charlie@example.com',
  senderName: 'Charlie Davis',
  snippet: 'Thanks for the update! Everything looks good to me.',
  participants: [{ email: 'charlie@example.com', name: 'Charlie Davis' }],
  createdAt: MOCK_TIMESTAMPS.yesterday,
  updatedAt: MOCK_TIMESTAMPS.yesterday,
  frecencyScore: 0.76,
};

export const MOCK_EMAIL_DRAFT: EmailEntity = {
  type: 'email',
  id: 'email_draft_1',
  name: 'Draft: Team Announcement',
  ownerId: MOCK_USER_IDS.currentUser,
  isRead: true,
  isDraft: true,
  isImportant: false,
  done: false,
  snippet: 'I wanted to share some exciting news with the team...',
  participants: [],
  createdAt: MOCK_TIMESTAMPS.today,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.81,
};

export const MOCK_EMAIL_THREAD: EmailEntity = {
  type: 'email',
  id: 'email_thread_1',
  name: 'Re: Design Review [4 messages]',
  ownerId: MOCK_USER_IDS.currentUser,
  isRead: false,
  isDraft: false,
  isImportant: true,
  done: false,
  senderEmail: 'diana@example.com',
  senderName: 'Diana Miller',
  snippet: 'I have some feedback on the latest designs...',
  participants: [
    { email: 'diana@example.com', name: 'Diana Miller' },
    { email: 'eve@example.com', name: 'Eve Wilson' },
    { email: MOCK_USER_IDS.currentUser, name: 'Current User' },
  ],
  createdAt: MOCK_TIMESTAMPS.lastWeek,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.89,
};

export const MOCK_EMAIL_MULTIPLE_PARTICIPANTS: EmailEntity = {
  type: 'email',
  id: 'email_multi_1',
  name: 'All Hands Meeting Next Week',
  ownerId: MOCK_USER_IDS.currentUser,
  isRead: false,
  isDraft: false,
  isImportant: false,
  done: false,
  senderEmail: 'frank@example.com',
  senderName: 'Frank Anderson',
  snippet:
    'Just a reminder that our all hands meeting is scheduled for next Monday...',
  participants: [
    { email: 'frank@example.com', name: 'Frank Anderson' },
    { email: 'grace@example.com', name: 'Grace Lee' },
    { email: 'henry@example.com', name: 'Henry Brown' },
    { email: 'iris@example.com', name: 'Iris Taylor' },
    { email: MOCK_USER_IDS.currentUser, name: 'Current User' },
  ],
  createdAt: MOCK_TIMESTAMPS.yesterday,
  updatedAt: MOCK_TIMESTAMPS.yesterday,
  frecencyScore: 0.78,
};

export const MOCK_PROJECT_1: ProjectEntity = {
  type: 'project',
  id: 'proj_1',
  name: 'Website Redesign',
  ownerId: MOCK_USER_IDS.owner,
  createdAt: MOCK_TIMESTAMPS.lastMonth,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.91,
};

export const MOCK_PROJECT_2: ProjectEntity = {
  type: 'project',
  id: 'proj_2',
  name: 'Mobile App Development',
  ownerId: MOCK_USER_IDS.owner,
  createdAt: MOCK_TIMESTAMPS.lastYear,
  updatedAt: MOCK_TIMESTAMPS.lastWeek,
  frecencyScore: 0.84,
};

export const MOCK_PROJECT_SHARED: ProjectEntity = {
  type: 'project',
  id: 'proj_shared_1',
  name: 'Marketing Campaign 2025',
  ownerId: MOCK_USER_IDS.sharedUser,
  createdAt: MOCK_TIMESTAMPS.lastMonth,
  updatedAt: MOCK_TIMESTAMPS.yesterday,
  frecencyScore: 0.79,
};

export const MOCK_CHAT_BASIC: ChatEntity = {
  type: 'chat',
  id: 'chat_1',
  name: 'Product Brainstorm',
  ownerId: MOCK_USER_IDS.currentUser,
  createdAt: MOCK_TIMESTAMPS.lastWeek,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.86,
};

export const MOCK_CHAT_WITH_PROJECT: ChatEntity = {
  type: 'chat',
  id: 'chat_project_1',
  name: 'Design Discussion',
  ownerId: MOCK_USER_IDS.owner,
  projectId: 'proj_1',
  createdAt: MOCK_TIMESTAMPS.lastMonth,
  updatedAt: MOCK_TIMESTAMPS.yesterday,
  frecencyScore: 0.82,
};

export const MOCK_SEARCH_DOCUMENT: WithSearch<DocumentEntity> = {
  ...MOCK_DOCUMENT_BASIC,
  search: {
    nameHighlight: 'Meeting **Notes**',
    contentHitData: [
      {
        type: 'md',
        content: 'Discussed the **Q1 budget** and resource allocation',
        location: { type: 'md', nodeId: 'node_1' },
      },
      {
        type: 'md',
        content: 'Action items: Review the **budget proposal** by Friday',
        location: { type: 'md', nodeId: 'node_2' },
      },
    ],
    source: 'service',
  },
};

export const MOCK_SEARCH_CHANNEL: WithSearch<ChannelEntity> = {
  ...MOCK_CHANNEL_PUBLIC,
  search: {
    nameHighlight: '**general**',
    contentHitData: [
      {
        type: 'channel',
        id: 'msg_1',
        content: 'Has anyone seen the **budget report**?',
        senderId: MOCK_USER_IDS.teamMember1,
        sentAt: MOCK_TIMESTAMPS.today,
        location: {
          type: 'channel',
          messageId: 'msg_1',
        },
      },
      {
        type: 'channel',
        id: 'msg_2',
        content: 'I uploaded it to the **shared drive**',
        senderId: MOCK_USER_IDS.teamMember2,
        sentAt: MOCK_TIMESTAMPS.today,
        location: {
          type: 'channel',
          messageId: 'msg_2',
        },
      },
    ],
    source: 'service',
  },
};

export const MOCK_SEARCH_EMAIL: WithSearch<EmailEntity> = {
  ...MOCK_EMAIL_THREAD,
  search: {
    nameHighlight: '**Design** Review',
    contentHitData: [
      {
        type: 'email',
        content: 'The **design mockups** look great!',
        sender: 'Diana Miller',
        senderId: 'diana@example.com',
        sentAt: MOCK_TIMESTAMPS.yesterday,
        location: {
          type: 'email',
          messageId: 'email_msg_1',
        },
      },
      {
        type: 'email',
        content: 'I agree, but we should adjust the **color scheme**',
        sender: 'Eve Wilson',
        senderId: 'eve@example.com',
        sentAt: MOCK_TIMESTAMPS.today,
        location: {
          type: 'email',
          messageId: 'email_msg_2',
        },
      },
    ],
    source: 'service',
  },
};

export const MOCK_SEARCH_PDF: WithSearch<DocumentEntity> = {
  ...MOCK_DOCUMENT_PDF,
  search: {
    nameHighlight: '**Design** Specifications.pdf',
    contentHitData: [
      {
        type: 'pdf',
        content: 'Section 3.2: **Color Palette** and Typography',
        location: {
          type: 'pdf',
          searchPage: 5,
          highlightTerms: ['Color', 'Palette'],
          searchSnippet: 'Color Palette and Typography',
          searchRawQuery: 'color palette',
        },
      },
    ],
    source: 'service',
  },
};

export const createEntityWithNotifications = <T extends object>(
  entity: T,
  notifications: Notification[]
): WithNotification<T> => ({
  ...entity,
  notifications: () => notifications,
});

export const MOCK_DOCUMENT_WITH_NOTIFICATIONS = createEntityWithNotifications(
  MOCK_DOCUMENT_BASIC,
  [MOCK_NOTIFICATIONS[0]]
);

export const MOCK_TASK_WITH_NOTIFICATIONS = createEntityWithNotifications(
  MOCK_TASK_TODO,
  [MOCK_NOTIFICATIONS[1]]
);

export const MOCK_CHANNEL_WITH_NOTIFICATIONS = createEntityWithNotifications(
  MOCK_CHANNEL_PUBLIC,
  [MOCK_NOTIFICATIONS[2]]
);

export const MOCK_SHARED_DOCUMENT: DocumentEntity = {
  ...MOCK_DOCUMENT_BASIC,
  id: 'doc_shared_1',
  name: 'Shared Project Plan',
  ownerId: MOCK_USER_IDS.sharedUser,
};

export const MOCK_SHARED_TASK: TaskEntity = {
  ...MOCK_TASK_TODO,
  id: 'task_shared_1',
  name: 'Shared Task',
  ownerId: MOCK_USER_IDS.teamMember1,
};

export const MOCK_TASK_WITH_PROPERTIES = MOCK_TASK_TODO;
export const MOCK_TASK_PROPERTIES = MOCK_PROPERTIES;

export const MOCK_ENTITY_MISSING_FIELDS: DocumentEntity = {
  type: 'document',
  id: 'doc_minimal_1',
  name: 'Minimal Document',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  // Missing optional fields like createdAt, updatedAt, frecencyScore
};

export const MOCK_ENTITY_VERY_OLD: DocumentEntity = {
  type: 'document',
  id: 'doc_old_1',
  name: 'Archive Document 2020',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  createdAt: new Date('2020-01-01').toISOString(),
  updatedAt: new Date('2020-06-15').toISOString(),
  frecencyScore: 0.12,
};

export const MOCK_ENTITY_UNICODE: DocumentEntity = {
  type: 'document',
  id: 'doc_unicode_1',
  name: '🚀 Product Launch 2025 💡 Ideas & Notes ✨',
  ownerId: MOCK_USER_IDS.owner,
  fileType: 'md',
  createdAt: MOCK_TIMESTAMPS.lastWeek,
  updatedAt: MOCK_TIMESTAMPS.today,
  frecencyScore: 0.88,
};

export const ALL_DOCUMENT_ENTITIES = [
  MOCK_DOCUMENT_BASIC,
  MOCK_DOCUMENT_WITH_PROJECT,
  MOCK_DOCUMENT_PDF,
  MOCK_DOCUMENT_LONG_NAME,
  MOCK_DOCUMENT_SPECIAL_CHARS,
  MOCK_SHARED_DOCUMENT,
  MOCK_ENTITY_MISSING_FIELDS,
  MOCK_ENTITY_VERY_OLD,
  MOCK_ENTITY_UNICODE,
];

export const ALL_TASK_ENTITIES = [
  MOCK_TASK_TODO,
  MOCK_TASK_COMPLETED,
  MOCK_TASK_HIGH_PRIORITY,
  MOCK_SHARED_TASK,
];

export const ALL_CHANNEL_ENTITIES = [
  MOCK_CHANNEL_PUBLIC,
  MOCK_CHANNEL_PRIVATE,
  MOCK_CHANNEL_DIRECT_MESSAGE,
  MOCK_CHANNEL_ORGANIZATION,
  MOCK_CHANNEL_EMPTY_MESSAGE,
];

export const ALL_EMAIL_ENTITIES = [
  MOCK_EMAIL_UNREAD,
  MOCK_EMAIL_READ,
  MOCK_EMAIL_DRAFT,
  MOCK_EMAIL_THREAD,
  MOCK_EMAIL_MULTIPLE_PARTICIPANTS,
];

export const ALL_PROJECT_ENTITIES = [
  MOCK_PROJECT_1,
  MOCK_PROJECT_2,
  MOCK_PROJECT_SHARED,
];

export const ALL_CHAT_ENTITIES = [MOCK_CHAT_BASIC, MOCK_CHAT_WITH_PROJECT];

export const ALL_SEARCH_ENTITIES = [
  MOCK_SEARCH_DOCUMENT,
  MOCK_SEARCH_CHANNEL,
  MOCK_SEARCH_EMAIL,
  MOCK_SEARCH_PDF,
];

export const ALL_ENTITIES_WITH_NOTIFICATIONS = [
  MOCK_DOCUMENT_WITH_NOTIFICATIONS,
  MOCK_TASK_WITH_NOTIFICATIONS,
  MOCK_CHANNEL_WITH_NOTIFICATIONS,
];

export const ALL_SHARED_ENTITIES = [
  MOCK_SHARED_DOCUMENT,
  MOCK_SHARED_TASK,
  MOCK_PROJECT_SHARED,
];

/**
 * Comprehensive collection of all mock entities for testing
 */
export const ALL_MOCK_ENTITIES = [
  ...ALL_DOCUMENT_ENTITIES,
  ...ALL_TASK_ENTITIES,
  ...ALL_CHANNEL_ENTITIES,
  ...ALL_EMAIL_ENTITIES,
  ...ALL_PROJECT_ENTITIES,
  ...ALL_CHAT_ENTITIES,
];
