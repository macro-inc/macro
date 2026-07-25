import {
  ENABLE_BEARER_TOKEN_AUTH,
  ENABLE_GRAPHQL_SOUP,
} from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchToken } from '@core/util/fetchWithToken';
import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  createTauriCacheHost,
  createWorkerCacheHost,
} from '@graphql-cache/index';
import { registerCacheHost } from '@graphql-cache/lifecycle';
import { getOrCreateCacheScope } from '@graphql-cache/scope';
import { getMacroApiToken } from '@service-auth/fetch';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { match } from 'ts-pattern';
import type { SoupApiItem, SoupPage } from './generated/schemas';
import {
  type GroupedSoupInput,
  type GroupSoupQuery,
  GroupSoupDocument as GroupSoupQueryDocument,
  type GroupSoupQueryVariables,
  type SoupInitialInput,
  type SoupInput,
  type SoupQuery,
  SoupDocument as SoupQueryDocument,
  type SoupQueryVariables,
} from './graphql/generated/graphql';

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
  url: `${dssHost}/items/soup/graphql`,
  exchanges: [fetchExchange],
  fetch: dssGraphqlFetch,
});

/**
 * Whether the normalized cache is active for soup GraphQL queries.
 * Browser: wasm engine in a worker. Tauri: native engine in the host
 * process (graphql_cache_plugin).
 */
export function graphqlCacheEnabled(): boolean {
  return ENABLE_GRAPHQL_SOUP();
}

let cachedClient: Client | undefined;
let cachedCacheHost: CacheHost | undefined;

/** Returns the persistent normalized-cache host after client initialization. */
export function getGraphqlCacheHost(): CacheHost | undefined {
  return cachedCacheHost?.disabled ? undefined : cachedCacheHost;
}

/**
 * Resolves the urql client, lazily assembling the cached client on first
 * use. The cache scope is an anonymous client uuid — no identity lookup is
 * needed (or wanted) here: user↔cache consistency is enforced inside the
 * engine by the identity witness on `QueryRoot.user.id` (a response for a
 * different user wipes and rebinds the cache). See @graphql-cache/scope.
 * Any failure falls back to the plain fetch client for the session.
 */
export function getGraphqlSoupClient(): Client {
  if (!graphqlCacheEnabled()) return graphqlSoupClient;
  cachedClient ??= (() => {
    let host: CacheHost | undefined;
    let unregisterHost: () => void = () => undefined;
    const onInitializationError = (error: Error) => {
      if (!host || cachedCacheHost !== host) return;
      unregisterHost();
      host.dispose();
      cachedCacheHost = undefined;
      cachedClient = graphqlSoupClient;
      console.warn(
        'graphql cache async init failed; using uncached client',
        error
      );
    };
    try {
      const scope = getOrCreateCacheScope();
      host = isTauri()
        ? createTauriCacheHost({ scope, onInitializationError })
        : createWorkerCacheHost({ scope, onInitializationError });
      const client = createClient({
        url: `${dssHost}/items/soup/graphql`,
        exchanges: [
          normalizedCacheExchange(host, {
            // Session identity witness: the viewer id present on every soup
            // response. A response for a different user silently wipes and
            // rebinds the cache (see @graphql-cache/scope).
            extractIdentity: (data) =>
              (data as Partial<SoupQuery | GroupSoupQuery> | undefined)?.user
                ?.id,
            // Transport failures remain queued with their optimistic layer;
            // GraphQL application errors are permanent and roll back.
            shouldRetryMutation: (error) => error.networkError != null,
          }),
          fetchExchange,
        ],
        fetch: dssGraphqlFetch,
      });
      cachedCacheHost = host;
      unregisterHost = registerCacheHost(host);
      return client;
    } catch (error) {
      host?.dispose();
      cachedCacheHost = undefined;
      console.warn('graphql cache init failed; using uncached client', error);
      return graphqlSoupClient;
    }
  })();
  return cachedClient;
}

/** Returns the cache host backing the flagged GraphQL Soup client. */
export function getGraphqlSoupCacheHost(): CacheHost | undefined {
  if (!graphqlCacheEnabled()) return undefined;
  getGraphqlSoupClient();
  return cachedCacheHost;
}

export type GraphqlSoupInput = SoupInput;
export type GraphqlSoupInitialInput = SoupInitialInput;
export type GraphqlGroupedSoupInput = GroupedSoupInput;

export type GraphqlGroupedSoupPage = {
  items: Record<string, SoupApiItem>;
  groups: Array<{
    key: string;
    totalCount: number;
    nextCursor: string | null;
    itemIds: string[];
  }>;
};

export type GraphqlSoupItem = SoupQuery['user']['soup']['items'][number];
type GraphqlSoupEntity = GraphqlSoupItem['entity'];
type GraphqlProperty = Extract<
  GraphqlSoupEntity,
  { __typename: 'GraphqlSoupDocument' }
>['properties'][number];
type GraphqlPropertyValue = NonNullable<GraphqlProperty['value']>;
type GraphqlSoupDocument = Extract<
  GraphqlSoupEntity,
  { __typename: 'GraphqlSoupDocument' }
>;
type GraphqlSoupChannelMessage = NonNullable<
  Extract<
    GraphqlSoupEntity,
    { __typename: 'GraphqlSoupChannel' }
  >['latestMessage']
>;
type GraphqlSoupNotification = Extract<
  GraphqlSoupEntity,
  { __typename: 'GraphqlSoupDocument' }
>['notifications'][number];

function mapGraphqlPropertyValue(
  value: GraphqlPropertyValue | null | undefined
) {
  if (!value) return value;

  return match(value)
    .with({ __typename: 'GraphqlBooleanPropertyValue' }, ({ boolValue }) => ({
      type: 'Boolean' as const,
      value: boolValue,
    }))
    .with({ __typename: 'GraphqlNumberPropertyValue' }, ({ numberValue }) => ({
      type: 'Number' as const,
      value: numberValue,
    }))
    .with({ __typename: 'GraphqlStringPropertyValue' }, ({ stringValue }) => ({
      type: 'String' as const,
      value: stringValue,
    }))
    .with({ __typename: 'GraphqlDatePropertyValue' }, ({ dateValue }) => ({
      type: 'Date' as const,
      value: dateValue,
    }))
    .with(
      { __typename: 'GraphqlSelectOptionPropertyValue' },
      ({ optionIds }) => ({
        type: 'SelectOption' as const,
        value: optionIds,
      })
    )
    .with(
      { __typename: 'GraphqlEntityReferencePropertyValue' },
      ({ references }) => ({
        type: 'EntityReference' as const,
        value: references.map((reference) => ({
          entity_id: reference.entityId,
          entity_type: reference.entityType,
          specific_message_id: reference.specificMessageId ?? undefined,
        })),
      })
    )
    .with({ __typename: 'GraphqlLinkPropertyValue' }, ({ urls }) => ({
      type: 'Link' as const,
      value: urls,
    }))
    .exhaustive();
}

function mapGraphqlProperties(properties: GraphqlProperty[]) {
  return properties.map((property) => ({
    id: property.id,
    definition: {
      id: property.propertyDefinitionId,
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
    message_id: message.id,
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

function mapGraphqlNotificationEntityType(
  entityType: GraphqlSoupNotification['entityType']
) {
  return entityType.toLowerCase();
}

function mapGraphqlNotifications(notifications: GraphqlSoupNotification[]) {
  return notifications.map((notification) => ({
    id: notification.id,
    notification_event_type: notification.eventType,
    notification_metadata: notification.metadata,
    entity_id: notification.entityId,
    entity_type: mapGraphqlNotificationEntityType(notification.entityType),
    sent: notification.sent,
    done: notification.done,
    seen: notification.seen,
    created_at: notification.createdAt,
    viewed_at: notification.viewedAt ?? undefined,
    updated_at: notification.updatedAt,
    sender_id: notification.senderId ?? undefined,
  }));
}

export function mapGraphqlSoupItem(item: GraphqlSoupItem): SoupApiItem {
  const frecency = item.frecencyScore;
  // `is_favorited: false` below: the GraphQL soup surface has no favorites
  // data; the REST `SoupApiItem` shape requires the flag, and nothing
  // consumes it on this path yet.

  return match(item.entity)
    .with(
      { __typename: 'GraphqlSoupDocument' },
      (entity) =>
        ({
          tag: 'document',
          frecency_score: frecency,
          is_favorited: false,
          data: {
            id: entity.id,
            name: entity.documentName,
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
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupChat' },
      (entity) =>
        ({
          tag: 'chat',
          frecency_score: frecency,
          is_favorited: false,
          data: {
            id: entity.id,
            name: entity.chatName,
            ownerId: entity.ownerId,
            projectId: entity.projectId ?? undefined,
            isPersistent: entity.isPersistent,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            viewedAt: entity.viewedAt ?? undefined,
            deletedAt: entity.deletedAt ?? undefined,
            properties: mapGraphqlProperties(entity.properties),
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupProject' },
      (entity) =>
        ({
          tag: 'project',
          frecency_score: frecency,
          is_favorited: false,
          data: {
            id: entity.id,
            name: entity.projectName,
            ownerId: entity.ownerId,
            parentId: entity.parentId ?? undefined,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            viewedAt: entity.viewedAt ?? undefined,
            deletedAt: entity.deletedAt ?? undefined,
            properties: mapGraphqlProperties(entity.properties),
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupEmailThread' },
      (entity) =>
        ({
          tag: 'emailThread',
          frecency_score: frecency,
          is_favorited: false,
          data: {
            id: entity.id,
            providerId: entity.providerId ?? undefined,
            ownerId: entity.ownerId,
            inboxVisible: entity.inboxVisible,
            name: entity.emailName ?? undefined,
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
              providerAttachmentId:
                attachment.providerAttachmentId ?? undefined,
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
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupChannel' },
      (entity) =>
        ({
          tag: 'channel',
          frecency_score: frecency,
          is_favorited: false,
          data: {
            channel: {
              id: entity.id,
              name: entity.channelName ?? undefined,
              channel_type: normalizeChannelType(entity.channelType),
              owner_id: entity.ownerId,
              org_id: entity.organizationId ?? undefined,
              team_id: entity.channelTeamId ?? undefined,
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
            is_participant: entity.isParticipant,
            viewed_at: entity.viewedAt ?? undefined,
            interacted_at: entity.interactedAt ?? undefined,
            latest_message: mapChannelMessage(entity.latestMessage),
            latest_non_thread_message: mapChannelMessage(
              entity.latestNonThreadMessage
            ),
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupChannelThread' },
      (entity) =>
        ({
          tag: 'channelThread',
          frecency_score: frecency,
          is_favorited: false,
          data: {
            id: entity.id,
            attachments: [],
            channel_id: entity.channelId,
            content: entity.content,
            created_at: entity.createdAt,
            reactions: [],
            sender: {
              id: entity.senderId,
              type: 'user',
            },
            sender_id: entity.senderId,
            thread: {
              latest_reply_at: entity.effectiveUpdatedAt,
              preview: [],
              reply_count: entity.replyCount,
            },
            updated_at: entity.updatedAt,
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupCall' },
      (entity) =>
        ({
          tag: 'call',
          frecency_score: frecency,
          is_favorited: false,
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
            properties: mapGraphqlProperties(entity.properties),
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupCrmCompany' },
      (entity) =>
        ({
          tag: 'crmCompany',
          frecency_score: frecency,
          is_favorited: false,
          data: {
            id: entity.id,
            teamId: entity.crmTeamId,
            name: entity.crmCompanyName ?? undefined,
            description: entity.description ?? undefined,
            emailSync: entity.emailSync,
            hidden: entity.hidden,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            viewedAt: entity.viewedAt ?? undefined,
            domains: entity.domains.map((domain) => ({
              id: `${entity.id}:${domain}`,
              companyId: entity.id,
              domain,
              createdAt: entity.createdAt,
            })),
            properties: mapGraphqlProperties(entity.properties),
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupForeignEntity' },
      (entity) =>
        ({
          tag: 'foreignEntity',
          frecency_score: frecency,
          is_favorited: false,
          data: {
            id: entity.id,
            foreignEntityId: entity.foreignEntityId,
            foreignEntitySource: entity.foreignEntitySource,
            storedForId: entity.storedForId,
            storedForAuthEntity: entity.storedForAuthEntity,
            metadata: entity.metadata,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .exhaustive();
}

export type FetchGraphqlSoupOptions = {
  signal?: AbortSignal;
  /** Defaults to true for normal foreground Soup reads. */
  allowOfflineFallback?: boolean;
};

/**
 * Maps a GraphQL soup response to the REST `SoupPage` shape consumed by
 * the existing soup pipeline (both the imperative fetch below and the
 * reactive urql subscriptions).
 */
export function mapGraphqlSoupPage(data: SoupQuery): SoupPage {
  return {
    items: data.user.soup.items.map(mapGraphqlSoupItem),
    next_cursor: data.user.soup.nextCursor ?? undefined,
  };
}

/** Maps grouped GraphQL bins to the normalized item pool used by Soup views. */
export function mapGraphqlGroupedSoupPage(
  data: GroupSoupQuery
): GraphqlGroupedSoupPage {
  const items: Record<string, SoupApiItem> = {};
  const groups = data.user.groupSoup.bins.map((bin) => {
    const itemIds = bin.items.map((item) => {
      items[item.id] = mapGraphqlSoupItem(item);
      return item.id;
    });

    return {
      key: bin.key,
      totalCount: bin.totalCount,
      nextCursor: bin.nextCursor ?? null,
      itemIds,
    };
  });

  return { items, groups };
}

export async function fetchGraphqlSoup(
  input: GraphqlSoupInput,
  options: FetchGraphqlSoupOptions = {}
): Promise<SoupPage> {
  const client = getGraphqlSoupClient();
  const useCache = graphqlCacheEnabled();

  // `cache-and-network` writes responses through the normalized cache;
  // `.toPromise()` skips the stale cache emission, so callers keep
  // network-fresh semantics. Reactive urql consumers will see the
  // stale-then-fresh stream once components migrate.
  const result = await client
    .query<SoupQuery, SoupQueryVariables>(
      SoupQueryDocument,
      { input },
      {
        ...(useCache ? { requestPolicy: 'cache-and-network' as const } : {}),
        ...(options.signal ? { fetchOptions: { signal: options.signal } } : {}),
      }
    )
    .toPromise();

  if (result.error) {
    // Offline replay: a network failure falls back to the last cached page.
    if (
      options.allowOfflineFallback !== false &&
      useCache &&
      result.error.networkError
    ) {
      const cached = await client
        .query<SoupQuery, SoupQueryVariables>(
          SoupQueryDocument,
          { input },
          { requestPolicy: 'cache-only' }
        )
        .toPromise();
      if (cached.data) {
        return mapGraphqlSoupPage(cached.data);
      }
    }
    throw result.error;
  }

  const data = result.data;
  if (!data) {
    throw new Error('GraphQL Soup query returned no data');
  }

  return mapGraphqlSoupPage(data);
}

/** Fetch grouped Soup bins through the GraphQL endpoint. */
export async function fetchGraphqlGroupedSoup(
  input: GraphqlGroupedSoupInput,
  options: FetchGraphqlSoupOptions = {}
): Promise<GraphqlGroupedSoupPage> {
  const client = getGraphqlSoupClient();
  const useCache = graphqlCacheEnabled();
  const variables = { input };
  const result = await client
    .query<GroupSoupQuery, GroupSoupQueryVariables>(
      GroupSoupQueryDocument,
      variables,
      {
        ...(useCache ? { requestPolicy: 'cache-and-network' as const } : {}),
        ...(options.signal ? { fetchOptions: { signal: options.signal } } : {}),
      }
    )
    .toPromise();

  if (result.error) {
    if (
      options.allowOfflineFallback !== false &&
      useCache &&
      result.error.networkError
    ) {
      const cached = await client
        .query<GroupSoupQuery, GroupSoupQueryVariables>(
          GroupSoupQueryDocument,
          variables,
          { requestPolicy: 'cache-only' }
        )
        .toPromise();
      if (cached.data) return mapGraphqlGroupedSoupPage(cached.data);
    }
    throw result.error;
  }

  if (!result.data) {
    throw new Error('GraphQL grouped Soup query returned no data');
  }

  return mapGraphqlGroupedSoupPage(result.data);
}
