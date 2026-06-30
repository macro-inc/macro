import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchToken } from '@core/util/fetchWithToken';
import { platformFetch } from '@core/util/platformFetch';
import { getMacroApiToken } from '@service-auth/fetch';
import { createClient, fetchExchange } from '@urql/core';
import type { SoupApiItem, SoupPage } from './generated/schemas';

const dssHost = SERVER_HOSTS['document-storage-service'];

function mergeHeaders(...headers: Array<HeadersInit | undefined>): Headers {
  const result = new Headers();
  for (const source of headers) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => result.set(key, value));
  }
  return result;
}

async function dssGraphqlFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (ENABLE_BEARER_TOKEN_AUTH) {
    const apiToken = await getMacroApiToken();
    return await platformFetch(input, {
      ...init,
      headers: mergeHeaders(init?.headers, {
        Authorization: `Bearer ${apiToken}`,
      }),
    });
  }

  const fetchWithCredentials = () =>
    platformFetch(input, { ...init, credentials: 'include' });

  let response = await fetchWithCredentials();
  if (response.status !== 401) return response;

  const tokenResult = await fetchToken();
  if (tokenResult.isErr()) return response;

  response = await fetchWithCredentials();
  return response;
}

const graphqlSoupClient = createClient({
  url: `${dssHost}/soup/graphql`,
  exchanges: [fetchExchange],
  fetch: dssGraphqlFetch,
});

export type GraphqlDateLiteralInput =
  | { gt: string }
  | { gte: string }
  | { lt: string }
  | { lte: string };

export type GraphqlExprInput<TLiteral> =
  | {
      and: {
        left: GraphqlExprInput<TLiteral>;
        right: GraphqlExprInput<TLiteral>;
      };
    }
  | {
      or: {
        left: GraphqlExprInput<TLiteral>;
        right: GraphqlExprInput<TLiteral>;
      };
    }
  | { not: GraphqlExprInput<TLiteral> }
  | { literal: TLiteral };

export type GraphqlDocumentLiteralInput =
  | { fileType: string }
  | { id: string }
  | { projectId: string }
  | { owner: string }
  | { importance: boolean }
  | { notificationDone: boolean }
  | { notificationSeen: boolean }
  | { includeCbmAtmNc: boolean }
  | { subType: 'TASK' | 'SNIPPET' }
  | { isEmailAttachment: boolean }
  | { createdAt: GraphqlDateLiteralInput }
  | { updatedAt: GraphqlDateLiteralInput };

export type GraphqlProjectLiteralInput =
  | { projectId: string }
  | { projectIdSelf: string }
  | { owner: string }
  | { importance: boolean }
  | { notificationDone: boolean }
  | { notificationSeen: boolean }
  | { createdAt: GraphqlDateLiteralInput }
  | { updatedAt: GraphqlDateLiteralInput };

export type GraphqlChatLiteralInput =
  | { projectId: string }
  | { role: 'USER' | 'SYSTEM' | 'ASSISTANT' }
  | { chatId: string }
  | { owner: string }
  | { importance: boolean }
  | { notificationDone: boolean }
  | { notificationSeen: boolean }
  | { createdAt: GraphqlDateLiteralInput }
  | { updatedAt: GraphqlDateLiteralInput };

export type GraphqlEmailValueInput =
  | { partial: string }
  | { complete: string }
  | { domain: string };

export type GraphqlEmailLiteralInput =
  | { sender: GraphqlEmailValueInput }
  | { cc: GraphqlEmailValueInput }
  | { bcc: GraphqlEmailValueInput }
  | { recipient: GraphqlEmailValueInput }
  | { threadId: string }
  | { owner: string }
  | { projectId: string }
  | { importance: boolean }
  | { notificationDone: boolean }
  | { notificationSeen: boolean }
  | { shared: 'EXCLUDE' | 'INCLUDE' | 'ONLY' }
  | { calendarOnly: boolean }
  | { createdAt: GraphqlDateLiteralInput }
  | { updatedAt: GraphqlDateLiteralInput };

export type GraphqlChannelLiteralInput =
  | { threadId: string }
  | { mention: string }
  | { organizationId: number }
  | { teamId: string }
  | { channelId: string }
  | { sender: string }
  | { channelType: 'PUBLIC' | 'PRIVATE' | 'DIRECT_MESSAGE' | 'TEAM' }
  | { importance: boolean }
  | { notificationDone: boolean }
  | { notificationSeen: boolean };

export type GraphqlChannelThreadLiteralInput =
  | { threadId: string }
  | { channelId: string }
  | { rootSender: string }
  | { notificationDone: boolean }
  | { notificationSeen: boolean };

export type GraphqlCallLiteralInput =
  | { callId: string }
  | { channelId: string }
  | { speaker: string }
  | { status: 'ATTENDED' | 'MISSED' | 'UNATTENDED' }
  | { attended: boolean };

export type GraphqlCrmCompanyLiteralInput =
  | { id: string }
  | { hidden: boolean };

export type GraphqlForeignEntityLiteralInput =
  | { id: string }
  | { foreignEntityId: string }
  | { foreignEntitySource: string }
  | { includesMe: boolean }
  | { notificationDone: boolean }
  | { notificationSeen: boolean };

export type GraphqlPropertiesLiteralInput = {
  propertyDefinitionId: string;
  entityType?:
    | 'CHANNEL'
    | 'CHAT'
    | 'COMPANY'
    | 'DOCUMENT'
    | 'PROJECT'
    | 'TASK'
    | 'THREAD'
    | 'USER';
  value: { selectOption: string } | { entityRef: string };
};

export type GraphqlEntityFilterAstInput = {
  documentFilter?: GraphqlExprInput<GraphqlDocumentLiteralInput>;
  projectFilter?: GraphqlExprInput<GraphqlProjectLiteralInput>;
  chatFilter?: GraphqlExprInput<GraphqlChatLiteralInput>;
  emailFilter?: {
    tree?: GraphqlExprInput<GraphqlEmailLiteralInput>;
    crmScope?: { domains: string[] } | { addresses: string[] };
  };
  channelFilter?: GraphqlExprInput<GraphqlChannelLiteralInput>;
  channelThreadFilter?: GraphqlExprInput<GraphqlChannelThreadLiteralInput>;
  callFilter?: GraphqlExprInput<GraphqlCallLiteralInput>;
  crmCompanyFilter?: GraphqlExprInput<GraphqlCrmCompanyLiteralInput>;
  foreignEntityFilter?: GraphqlExprInput<GraphqlForeignEntityLiteralInput>;
  propertiesFilter?: GraphqlExprInput<GraphqlPropertiesLiteralInput>;
};

export type GraphqlSoupInput = {
  limit?: number;
  expand?: boolean;
  sortMethod?: 'VIEWED_AT' | 'CREATED_AT' | 'UPDATED_AT' | 'VIEWED_UPDATED';
  cursor?: string | null;
  emailView?:
    | 'INBOX'
    | 'DRAFTS'
    | 'SENT'
    | 'ALL'
    | 'STARRED'
    | 'IMPORTANT'
    | 'OTHER';
  filters?: GraphqlEntityFilterAstInput;
};

type GraphqlSoupPropertyValue = {
  kind: string;
  boolValue?: boolean | null;
  numberValue?: number | null;
  stringValue?: string | null;
  dateValue?: string | null;
  selectOptionIds: string[];
  entityReferences: Array<{
    entityId: string;
    entityType: string;
    specificMessageId?: string | null;
  }>;
  links: string[];
};

type GraphqlSoupProperty = {
  id: string;
  displayName: string;
  dataType: string;
  isMultiSelect: boolean;
  specificEntityType?: string | null;
  isSystem: boolean;
  isMetadata: boolean;
  value?: GraphqlSoupPropertyValue | null;
};

type GraphqlSoupEntityBase = { __typename: string };

type GraphqlSoupDocument = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupDocument';
  id: string;
  name: string;
  ownerId: string;
  fileType?: string | null;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
  viewedAt?: string | null;
  deletedAt?: string | null;
  subType?: { kind: string; isCompleted?: boolean | null } | null;
  properties: GraphqlSoupProperty[];
};

type GraphqlSoupChat = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupChat';
  id: string;
  name: string;
  ownerId: string;
  projectId?: string | null;
  isPersistent: boolean;
  createdAt: string;
  updatedAt: string;
  viewedAt?: string | null;
  deletedAt?: string | null;
  properties: GraphqlSoupProperty[];
};

type GraphqlSoupProject = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupProject';
  id: string;
  name: string;
  ownerId: string;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  viewedAt?: string | null;
  deletedAt?: string | null;
  properties: GraphqlSoupProperty[];
};

type GraphqlSoupEmailThread = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupEmailThread';
  id: string;
  providerId?: string | null;
  ownerId: string;
  inboxVisible: boolean;
  linkId?: string | null;
  name?: string | null;
  snippet?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
  senderPhotoUrl?: string | null;
  isRead: boolean;
  isDraft: boolean;
  isImportant: boolean;
  projectId?: string | null;
  sortTs: string;
  createdAt: string;
  updatedAt: string;
  viewedAt?: string | null;
  participants: Array<{
    id: string;
    linkId: string;
    name?: string | null;
    email?: string | null;
    sfsPhotoUrl?: string | null;
  }>;
  attachments: Array<{
    id: string;
    messageId: string;
    providerAttachmentId?: string | null;
    filename?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    contentId?: string | null;
    createdAt: string;
  }>;
  labels: Array<{
    id: string;
    linkId: string;
    providerLabelId: string;
    name: string;
    createdAt: string;
    messageListVisibility: string;
    labelListVisibility: string;
    type: string;
  }>;
  properties: GraphqlSoupProperty[];
};

type GraphqlSoupChannelMessage = {
  messageId: string;
  threadId?: string | null;
  senderId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  mentions: string[];
};

type GraphqlSoupChannel = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupChannel';
  id: string;
  name?: string | null;
  channelType: string;
  ownerId: string;
  organizationId?: number | null;
  teamId?: string | null;
  createdAt: string;
  updatedAt: string;
  viewedAt?: string | null;
  interactedAt?: string | null;
  participants: Array<{
    channelId: string;
    userId: string;
    role: string;
    joinedAt: string;
    leftAt?: string | null;
  }>;
  latestMessage?: GraphqlSoupChannelMessage | null;
  latestNonThreadMessage?: GraphqlSoupChannelMessage | null;
};

type GraphqlSoupChannelThread = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupChannelThread';
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  effectiveUpdatedAt: string;
  replyCount: number;
};

type GraphqlSoupCall = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupCall';
  id: string;
  channelId: string;
  channelName?: string | null;
  createdBy: string;
  customName?: string | null;
  summary?: string | null;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  isActive: boolean;
  status: string;
  attended: boolean;
  participants: Array<{
    userId: string;
    joinedAt: string;
    leftAt?: string | null;
  }>;
};

type GraphqlSoupCrmCompany = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupCrmCompany';
  id: string;
  teamId: string;
  name?: string | null;
  description?: string | null;
  emailSync: boolean;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  viewedAt?: string | null;
  domains: string[];
};

type GraphqlSoupForeignEntity = GraphqlSoupEntityBase & {
  __typename: 'GraphqlSoupForeignEntity';
  id: string;
  foreignEntityId: string;
  foreignEntitySource: string;
  storedForId: string;
  storedForAuthEntity: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

type GraphqlSoupEntity =
  | GraphqlSoupDocument
  | GraphqlSoupChat
  | GraphqlSoupProject
  | GraphqlSoupEmailThread
  | GraphqlSoupChannel
  | GraphqlSoupChannelThread
  | GraphqlSoupCall
  | GraphqlSoupCrmCompany
  | GraphqlSoupForeignEntity;

type GraphqlSoupItem = {
  id: string;
  entityType: string;
  frecencyScore: number;
  entity: GraphqlSoupEntity;
};

type GraphqlSoupResponse = {
  soup: {
    items: GraphqlSoupItem[];
    nextCursor?: string | null;
    hasMore: boolean;
  };
};

const SOUP_QUERY = `
  query Soup($input: SoupInput!) {
    soup(input: $input) {
      items {
        id
        entityType
        frecencyScore
        entity {
          __typename
          ... on GraphqlSoupDocument {
            id name ownerId fileType projectId createdAt updatedAt viewedAt deletedAt
            subType { kind isCompleted }
            properties { id displayName dataType isMultiSelect specificEntityType isSystem isMetadata value { kind boolValue numberValue stringValue dateValue selectOptionIds entityReferences { entityId entityType specificMessageId } links } }
          }
          ... on GraphqlSoupChat {
            id name ownerId projectId isPersistent createdAt updatedAt viewedAt deletedAt
            properties { id displayName dataType isMultiSelect specificEntityType isSystem isMetadata value { kind boolValue numberValue stringValue dateValue selectOptionIds entityReferences { entityId entityType specificMessageId } links } }
          }
          ... on GraphqlSoupProject {
            id name ownerId parentId createdAt updatedAt viewedAt deletedAt
            properties { id displayName dataType isMultiSelect specificEntityType isSystem isMetadata value { kind boolValue numberValue stringValue dateValue selectOptionIds entityReferences { entityId entityType specificMessageId } links } }
          }
          ... on GraphqlSoupEmailThread {
            id providerId ownerId inboxVisible linkId name snippet senderEmail senderName senderPhotoUrl isRead isDraft isImportant projectId sortTs createdAt updatedAt viewedAt
            participants { id linkId name email sfsPhotoUrl }
            attachments { id messageId providerAttachmentId filename mimeType sizeBytes contentId createdAt }
            labels { id linkId providerLabelId name createdAt messageListVisibility labelListVisibility type }
            properties { id displayName dataType isMultiSelect specificEntityType isSystem isMetadata value { kind boolValue numberValue stringValue dateValue selectOptionIds entityReferences { entityId entityType specificMessageId } links } }
          }
          ... on GraphqlSoupChannel {
            id name channelType ownerId organizationId teamId createdAt updatedAt viewedAt interactedAt
            participants { channelId userId role joinedAt leftAt }
            latestMessage { messageId threadId senderId content createdAt updatedAt deletedAt mentions }
            latestNonThreadMessage { messageId threadId senderId content createdAt updatedAt deletedAt mentions }
          }
          ... on GraphqlSoupChannelThread {
            id channelId senderId content createdAt updatedAt effectiveUpdatedAt replyCount
          }
          ... on GraphqlSoupCall {
            id channelId channelName createdBy customName summary startedAt endedAt durationMs isActive status attended
            participants { userId joinedAt leftAt }
          }
          ... on GraphqlSoupCrmCompany {
            id teamId name description emailSync hidden createdAt updatedAt viewedAt domains
          }
          ... on GraphqlSoupForeignEntity {
            id foreignEntityId foreignEntitySource storedForId storedForAuthEntity metadata createdAt updatedAt
          }
        }
      }
      nextCursor
      hasMore
    }
  }
`;

function mapGraphqlPropertyValue(
  value: GraphqlSoupPropertyValue | null | undefined
) {
  if (!value) return value;
  switch (value.kind) {
    case 'Boolean':
      return { type: 'Boolean' as const, value: value.boolValue ?? false };
    case 'Number':
      return { type: 'Number' as const, value: value.numberValue ?? 0 };
    case 'String':
      return { type: 'String' as const, value: value.stringValue ?? '' };
    case 'Date':
      return { type: 'Date' as const, value: value.dateValue ?? '' };
    case 'SelectOption':
      return { type: 'SelectOption' as const, value: value.selectOptionIds };
    case 'EntityReference':
      return {
        type: 'EntityReference' as const,
        value: value.entityReferences.map((ref) => ({
          entity_id: ref.entityId,
          entity_type: ref.entityType,
          specific_message_id: ref.specificMessageId ?? undefined,
        })),
      };
    case 'Link':
      return { type: 'Link' as const, value: value.links };
    default:
      return undefined;
  }
}

function mapGraphqlProperties(properties: GraphqlSoupProperty[]) {
  return properties.map((property) => ({
    definition: {
      id: property.id,
      display_name: property.displayName,
      data_type: property.dataType,
      is_multi_select: property.isMultiSelect,
      specific_entity_type: property.specificEntityType ?? undefined,
      is_system: property.isSystem,
      is_metadata: property.isMetadata,
      owner: { scope: 'system' as const },
      created_at: '',
      updated_at: '',
    },
    value: mapGraphqlPropertyValue(property.value),
  }));
}

function mapDocumentSubType(subType: GraphqlSoupDocument['subType']) {
  if (!subType) return undefined;
  const type = subType.kind.toLowerCase();
  if (type === 'task') {
    return {
      type: 'task' as const,
      is_completed: subType.isCompleted ?? false,
    };
  }
  if (type === 'snippet') return { type: 'snippet' as const };
  return undefined;
}

function mapChannelMessage(
  message: GraphqlSoupChannelMessage | null | undefined
) {
  if (!message) return message;
  return {
    message_id: message.messageId,
    thread_id: message.threadId ?? undefined,
    sender_id: message.senderId,
    content: message.content,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
    deleted_at: message.deletedAt ?? undefined,
    mentions: message.mentions,
  };
}

function normalizeChannelType(channelType: string) {
  return channelType.toLowerCase();
}

function mapGraphqlSoupItem(item: GraphqlSoupItem): SoupApiItem {
  const frecency = item.frecencyScore;
  const entity = item.entity;
  switch (entity.__typename) {
    case 'GraphqlSoupDocument':
      return {
        tag: 'document',
        frecency_score: frecency,
        data: {
          id: entity.id,
          name: entity.name,
          ownerId: entity.ownerId,
          fileType: entity.fileType ?? undefined,
          projectId: entity.projectId ?? undefined,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
          viewedAt: entity.viewedAt ?? undefined,
          deletedAt: entity.deletedAt ?? undefined,
          documentVersionId: 0,
          properties: mapGraphqlProperties(entity.properties),
          subType: mapDocumentSubType(entity.subType),
        },
      } as SoupApiItem;
    case 'GraphqlSoupChat':
      return {
        tag: 'chat',
        frecency_score: frecency,
        data: {
          id: entity.id,
          name: entity.name,
          ownerId: entity.ownerId,
          projectId: entity.projectId ?? undefined,
          isPersistent: entity.isPersistent,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
          viewedAt: entity.viewedAt ?? undefined,
          deletedAt: entity.deletedAt ?? undefined,
          properties: mapGraphqlProperties(entity.properties),
        },
      } as SoupApiItem;
    case 'GraphqlSoupProject':
      return {
        tag: 'project',
        frecency_score: frecency,
        data: {
          id: entity.id,
          name: entity.name,
          ownerId: entity.ownerId,
          parentId: entity.parentId ?? undefined,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
          viewedAt: entity.viewedAt ?? undefined,
          deletedAt: entity.deletedAt ?? undefined,
          properties: mapGraphqlProperties(entity.properties),
        },
      } as SoupApiItem;
    case 'GraphqlSoupEmailThread':
      return {
        tag: 'emailThread',
        frecency_score: frecency,
        data: {
          id: entity.id,
          providerId: entity.providerId ?? undefined,
          ownerId: entity.ownerId,
          inboxVisible: entity.inboxVisible,
          name: entity.name ?? undefined,
          snippet: entity.snippet ?? undefined,
          senderEmail: entity.senderEmail ?? undefined,
          senderName: entity.senderName ?? undefined,
          senderPhotoUrl: entity.senderPhotoUrl ?? undefined,
          isRead: entity.isRead,
          isDraft: entity.isDraft,
          isImportant: entity.isImportant,
          projectId: entity.projectId ?? undefined,
          sortTs: entity.sortTs,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
          viewedAt: entity.viewedAt ?? undefined,
          participants: entity.participants.map((participant) => ({
            id: participant.id,
            linkId: participant.linkId,
            name: participant.name ?? undefined,
            emailAddress: participant.email ?? undefined,
            sfsPhotoUrl: participant.sfsPhotoUrl ?? undefined,
          })),
          attachments: entity.attachments.map((attachment) => ({
            id: attachment.id,
            messageId: attachment.messageId,
            providerAttachmentId: attachment.providerAttachmentId ?? undefined,
            filename: attachment.filename ?? undefined,
            mimeType: attachment.mimeType ?? undefined,
            sizeBytes: attachment.sizeBytes ?? undefined,
            contentId: attachment.contentId ?? undefined,
            createdAt: attachment.createdAt,
          })),
          labels: entity.labels.map((label) => ({
            id: label.id,
            linkId: label.linkId,
            providerLabelId: label.providerLabelId,
            name: label.name,
            createdAt: label.createdAt,
            messageListVisibility: label.messageListVisibility,
            labelListVisibility: label.labelListVisibility,
            type: label.type,
          })),
          properties: mapGraphqlProperties(entity.properties),
        },
      } as SoupApiItem;
    case 'GraphqlSoupChannel':
      return {
        tag: 'channel',
        frecency_score: frecency,
        data: {
          channel: {
            id: entity.id,
            name: entity.name ?? undefined,
            channel_type: normalizeChannelType(entity.channelType),
            owner_id: entity.ownerId,
            org_id: entity.organizationId ?? undefined,
            team_id: entity.teamId ?? undefined,
            created_at: entity.createdAt,
            updated_at: entity.updatedAt,
          },
          participants: entity.participants.map((participant) => ({
            channel_id: participant.channelId,
            user_id: participant.userId,
            role: participant.role,
            joined_at: participant.joinedAt,
            left_at: participant.leftAt ?? undefined,
          })),
          viewed_at: entity.viewedAt ?? undefined,
          interacted_at: entity.interactedAt ?? undefined,
          latest_message: mapChannelMessage(entity.latestMessage),
          latest_non_thread_message: mapChannelMessage(
            entity.latestNonThreadMessage
          ),
        },
      } as SoupApiItem;
    case 'GraphqlSoupChannelThread':
      return {
        tag: 'channelThread',
        frecency_score: frecency,
        data: {
          id: entity.id,
          channel_id: entity.channelId,
          sender_id: entity.senderId,
          content: entity.content,
          created_at: entity.createdAt,
          updated_at: entity.updatedAt,
          effective_updated_at: entity.effectiveUpdatedAt,
          reply_count: entity.replyCount,
        },
      } as unknown as SoupApiItem;
    case 'GraphqlSoupCall':
      return {
        tag: 'call',
        frecency_score: frecency,
        data: {
          callId: entity.id,
          channelId: entity.channelId,
          channelName: entity.channelName ?? undefined,
          createdBy: entity.createdBy,
          customName: entity.customName ?? undefined,
          summary: entity.summary ?? undefined,
          startedAt: entity.startedAt,
          endedAt: entity.endedAt ?? undefined,
          durationMs: entity.durationMs ?? undefined,
          isActive: entity.isActive,
          status: entity.status,
          attended: entity.attended,
          participants: entity.participants.map((participant) => ({
            userId: participant.userId,
            joinedAt: participant.joinedAt,
            leftAt: participant.leftAt ?? undefined,
          })),
        },
      } as SoupApiItem;
    case 'GraphqlSoupCrmCompany':
      return {
        tag: 'crmCompany',
        frecency_score: frecency,
        data: {
          id: entity.id,
          teamId: entity.teamId,
          name: entity.name ?? undefined,
          description: entity.description ?? undefined,
          emailSync: entity.emailSync,
          hidden: entity.hidden,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
          viewedAt: entity.viewedAt ?? undefined,
          domains: entity.domains.map((domain, index) => ({
            id: `${entity.id}:${domain}`,
            companyId: entity.id,
            domain,
            createdAt: entity.createdAt,
            primary: index === 0,
          })),
        },
      } as SoupApiItem;
    case 'GraphqlSoupForeignEntity':
      return {
        tag: 'foreignEntity',
        frecency_score: frecency,
        data: {
          id: entity.id,
          foreignEntityId: entity.foreignEntityId,
          foreignEntitySource: entity.foreignEntitySource,
          storedForId: entity.storedForId,
          storedForAuthEntity: entity.storedForAuthEntity,
          metadata: entity.metadata,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        },
      } as SoupApiItem;
  }
}

export async function fetchGraphqlSoup(
  input: GraphqlSoupInput
): Promise<SoupPage> {
  const result = await graphqlSoupClient
    .query<GraphqlSoupResponse, { input: GraphqlSoupInput }>(SOUP_QUERY, {
      input,
    })
    .toPromise();

  if (result.error) {
    throw result.error;
  }

  const data = result.data;
  if (!data) {
    throw new Error('GraphQL Soup query returned no data');
  }

  return {
    items: data.soup.items.map(mapGraphqlSoupItem),
    next_cursor: data.soup.nextCursor ?? undefined,
  };
}
