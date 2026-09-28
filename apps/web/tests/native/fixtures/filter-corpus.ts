import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '../../../src/features/property/identifiers';
import { mailProjectionCapsules } from '../../../src/lib/graphql-cache/worker/browser-test/mail-projection-capsules';
import type { TagSetResponse } from '../../../src/lib/service-clients/service-properties/generated/schemas/tagSetResponse';
import { EMAIL, fixtureId as id, USER_ID } from './mail';

export const PEOPLE = [USER_ID, 'macro|other@example.com'];
export const TAG_DEFINITION = id(7000);
export const TAGS = [id(7001), id(7002)];
export const LINKS = [id(1000), id(1001)];
export const STATUS = [
  'not-started',
  'in-progress',
  'in-review',
  'completed',
  'canceled',
];
export const PRIORITY = ['urgent', 'high', 'medium', 'low'];
const statusIds = Object.values(PROPERTY_OPTION_IDS.STATUS);
const priorityIds = [
  PROPERTY_OPTION_IDS.PRIORITY.URGENT,
  PROPERTY_OPTION_IDS.PRIORITY.HIGH,
  PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
  PROPERTY_OPTION_IDS.PRIORITY.LOW,
];
export const FILE_TYPES = [
  'doc-markdown',
  'doc-canvas',
  'file-code',
  'file-image',
  'file-pdf',
  'file-docx',
  'file-video',
  'doc-snippet',
  'doc-skill',
  'file-other',
];
const fileTypes = [
  'md',
  'canvas',
  'ts',
  'png',
  'pdf',
  'docx',
  'mp4',
  'md',
  'md',
  'bin',
];
export const TIMESTAMP = '2025-01-04T00:00:00Z';

export type FixtureRow = {
  kind: 'file' | 'task' | 'project' | 'channel' | 'email';
  id: string;
  owner: string;
  tags: string[];
  fileType?: string;
  category?: string;
  attachment?: boolean;
  status?: string;
  priority?: string;
  assignees?: string[];
  linkId?: string;
  signal?: boolean;
  read?: boolean;
  inbox?: boolean;
  calendar?: boolean;
  shared?: boolean;
  draft?: boolean;
  sent?: boolean;
  attachmentKind?: 'pdf' | 'image' | 'document';
  direct?: boolean;
  api: Record<string, unknown>;
};

function property(
  n: number,
  definition: string,
  values: string[],
  entity = false
) {
  return {
    id: id(n),
    propertyDefinitionId: definition,
    displayName: definition,
    dataType: entity
      ? 'ENTITY'
      : definition === TAG_DEFINITION
        ? 'TAG'
        : 'SELECT_STRING',
    isMultiSelect: entity || definition === TAG_DEFINITION,
    specificEntityType: entity ? 'USER' : null,
    isSystem: definition !== TAG_DEFINITION,
    isMetadata: false,
    value: entity
      ? {
          __typename: 'GraphqlEntityReferencePropertyValue',
          references: values.map((entityId) => ({
            entityId,
            entityType: 'USER',
            specificMessageId: null,
          })),
        }
      : { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: values },
  };
}
const tagsFor = (n: number) => TAGS.filter((_, bit) => (n & (1 << bit)) !== 0);

/** Portable API fixtures shared by browser-side matrix assertions and the HTTP server. */
export function filterCorpus(
  capsules: Readonly<Record<string, string>> = {}
): FixtureRow[] {
  const result: FixtureRow[] = [];
  for (let n = 0; n < 40; n++) {
    const index = 201 + n;
    const status = Math.floor((n % 20) / 4);
    const priority = n % 4;
    const owner = PEOPLE[Math.floor(n / 20)];
    const assignees = PEOPLE.filter(
      (_, bit) => ((n + Math.floor(n / 20)) & (1 << bit)) !== 0
    );
    const tags = tagsFor(n + Math.floor(n / 4));
    result.push({
      kind: 'task',
      id: id(index),
      owner,
      tags,
      status: STATUS[status],
      priority: PRIORITY[priority],
      assignees,
      api: {
        __typename: 'GraphqlSoupDocument',
        id: id(index),
        entityType: 'DOCUMENT',
        name: `Task ${index}`,
        displayName: `Task ${index}`,
        cacheProjection: capsules[id(index)],
        ownerId: owner,
        fileType: 'md',
        projectId: null,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        viewedAt: null,
        deletedAt: null,
        subType: { __typename: 'GraphqlTaskSubType', isCompleted: status >= 3 },
        notifications: [],
        isFavorited: false,
        properties: [
          property(index * 10, SYSTEM_PROPERTY_IDS.STATUS, [statusIds[status]]),
          property(index * 10 + 1, SYSTEM_PROPERTY_IDS.PRIORITY, [
            priorityIds[priority],
          ]),
          property(
            index * 10 + 2,
            SYSTEM_PROPERTY_IDS.ASSIGNEES,
            assignees,
            true
          ),
          property(index * 10 + 3, TAG_DEFINITION, tags),
        ],
      },
    });
  }
  for (let n = 0; n < 20; n++) {
    const index = 101 + n;
    const category = n % FILE_TYPES.length;
    const owner = PEOPLE[Math.floor(n / 10)];
    const tags = tagsFor(n);
    const attachment = n % 3 === 0;
    result.push({
      kind: 'file',
      id: id(index),
      owner,
      tags,
      category: FILE_TYPES[category],
      fileType: fileTypes[category],
      attachment,
      api: {
        __typename: 'GraphqlSoupDocument',
        id: id(index),
        entityType: 'DOCUMENT',
        name: `File ${index}`,
        displayName: `File ${index}`,
        cacheProjection: capsules[id(index)],
        ownerId: owner,
        fileType: fileTypes[category],
        projectId: null,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        viewedAt: null,
        deletedAt: null,
        subType:
          category === 7
            ? { __typename: 'GraphqlSnippetSubType' }
            : category === 8
              ? { __typename: 'GraphqlSkillSubType' }
              : null,
        notifications: [],
        isFavorited: false,
        properties: [property(index * 10 + 3, TAG_DEFINITION, tags)],
      },
    });
  }
  for (let n = 0; n < 2; n++) {
    const index = 401 + n;
    const tags = [TAGS[n]];
    result.push({
      kind: 'project',
      id: id(index),
      owner: PEOPLE[n],
      tags,
      api: {
        __typename: 'GraphqlSoupProject',
        id: id(index),
        entityType: 'PROJECT',
        name: `Folder ${index}`,
        displayName: `Folder ${index}`,
        ownerId: PEOPLE[n],
        parentId: null,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        viewedAt: null,
        deletedAt: null,
        cacheProjection: null,
        notifications: [],
        isFavorited: false,
        properties: [property(index * 10, TAG_DEFINITION, tags)],
      },
    });
  }
  for (let n = 0; n < 3; n++) {
    const index = 501 + n;
    const message = {
      messageId: id(index + 10000),
      channelId: id(index),
      threadId: null,
      senderId: USER_ID,
      content: `Message ${index}`,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      deletedAt: null,
      mentions: [],
    };
    result.push({
      kind: 'channel',
      id: id(index),
      owner: USER_ID,
      tags: [],
      direct: n === 2,
      api: {
        __typename: 'GraphqlSoupChannel',
        id: id(index),
        entityType: 'CHANNEL',
        name: `Channel ${index}`,
        displayName: `Channel ${index}`,
        channelType:
          n === 2 ? 'direct_message' : n === 1 ? 'private' : 'public',
        ownerId: USER_ID,
        organizationId: null,
        teamId: null,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        viewedAt: null,
        interactedAt: null,
        isParticipant: true,
        participants: [
          {
            channelId: id(index),
            userId: USER_ID,
            role: 'owner',
            joinedAt: TIMESTAMP,
            leftAt: null,
          },
        ],
        latestMessage: message,
        latestNonThreadMessage: message,
        notifications: [],
        cacheProjection: null,
        isFavorited: false,
      },
    });
  }
  for (const n of [3, 4, 6, 8, 9, 10, 12, 60, 71, 72]) {
    const owner = n < 50 ? USER_ID : PEOPLE[1];
    const linkId = n < 50 ? LINKS[0] : n === 60 ? LINKS[1] : id(9999);
    const tags = tagsFor(n);
    const preview = (offset: number, subject: string) => ({
      id: id(n + offset),
      subject,
      snippet: subject,
      isDraft: offset === 20000,
      senderEmail: 'sender@example.com',
      senderName: 'Sender',
      senderPhotoUrl: null,
    });
    const attachmentKind = (['pdf', 'image', 'document'] as const)[n % 3];
    result.push({
      kind: 'email',
      id: id(n),
      owner,
      tags,
      linkId,
      signal: n % 3 === 0,
      read: n % 4 === 0,
      inbox: n % 2 === 0,
      calendar: n % 5 === 0,
      shared: n === 60 || n >= 71,
      draft: n % 3 === 0,
      // The canonical capsule for row 4 intentionally has no outbound timestamp.
      sent: n % 4 === 0 && n !== 4,
      attachmentKind,
      api: {
        __typename: 'GraphqlSoupEmailThread',
        id: id(n),
        entityType: 'EMAIL_THREAD',
        name: `Email ${n}`,
        displayName: `Email ${n}`,
        ownerId: owner,
        linkId,
        inboxVisible: n % 2 === 0,
        isRead: n % 4 === 0,
        isSignal: n % 3 === 0,
        isImportant: n % 3 === 0,
        isDraft: false,
        snippet: `Email ${n}`,
        senderEmail: 'sender@example.com',
        senderName: 'Sender',
        senderPhotoUrl: null,
        cacheProjection: mailProjectionCapsules[n - 1],
        latestInboundMessageTs: '2025-01-02T00:00:00Z',
        sortTs: TIMESTAMP,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        viewedAt: null,
        mailAllPreview: preview(10000, `Email ${n}`),
        mailDraftPreview: n % 3 === 0 ? preview(20000, `Draft ${n}`) : null,
        mailSentPreview: n % 4 === 0 ? preview(30000, `Sent ${n}`) : null,
        notifications: [],
        participants: [],
        labels: [],
        isFavorited: false,
        attachments: [
          {
            id: id(9000 + n),
            messageId: id(n + 10000),
            providerAttachmentId: 'fixture',
            filename: `attachment.${attachmentKind === 'image' ? 'png' : attachmentKind === 'document' ? 'docx' : 'pdf'}`,
            mimeType:
              attachmentKind === 'image'
                ? 'image/png'
                : attachmentKind === 'pdf'
                  ? 'application/pdf'
                  : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: 100,
            contentId: null,
            createdAt: TIMESTAMP,
          },
        ],
        properties: [property(8000 + n, TAG_DEFINITION, tags)],
      },
    });
  }
  return result;
}

export const matrixAccounts = LINKS.map((id, n) => ({
  id,
  emailAddress: n === 0 ? EMAIL : 'other@example.com',
  photoUrl: null,
}));
export const matrixTagSets: TagSetResponse[] = [
  {
    scope: 'user',
    definition: {
      id: TAG_DEFINITION,
      displayName: 'Fixture tags',
      dataType: 'TAG',
      isMetadata: false,
      isMultiSelect: true,
      isSystem: false,
      scope: 'user',
      user_id: USER_ID,
    },
    options: TAGS.map((id, n) => ({
      id,
      propertyDefinitionId: TAG_DEFINITION,
      displayOrder: n,
      color: null,
      value: { type: 'string', value: `Tag ${n + 1}` },
    })),
  },
];

export function documentCapsuleInputs() {
  return filterCorpus()
    .filter((row) => row.kind === 'file' || row.kind === 'task')
    .map((row) => ({
      id: row.id,
      isEmailAttachment: row.attachment ?? false,
      statusOptionIds: row.status
        ? [statusIds[STATUS.indexOf(row.status)]]
        : [],
    }));
}
