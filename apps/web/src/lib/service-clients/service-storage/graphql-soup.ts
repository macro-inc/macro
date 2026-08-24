import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchToken } from '@core/util/fetchWithToken';
import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import {
  HYDRATE_ONLY_CONTEXT_KEY,
  normalizedCacheExchange,
} from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  createTauriCacheHost,
  createWorkerCacheHost,
  entityFromArgument,
} from '@graphql-cache/index';
import { registerCacheHost } from '@graphql-cache/lifecycle';
import { getBrowserTursoCacheRolloutDecision } from '@graphql-cache/rollout';
import { getOrCreateCacheScope } from '@graphql-cache/scope';
import { getMacroApiToken } from '@service-auth/fetch';
import type { ApiUserNotification } from '@service-notification/generated/schemas/apiUserNotification';
import type { ChannelType } from '@service-notification/generated/schemas/channelType';
import type { GithubPrCheckRunState } from '@service-notification/generated/schemas/githubPrCheckRunState';
import type { GithubPrCommentKind } from '@service-notification/generated/schemas/githubPrCommentKind';
import type { GithubPrEventAction } from '@service-notification/generated/schemas/githubPrEventAction';
import type { GithubPrEventStatus } from '@service-notification/generated/schemas/githubPrEventStatus';
import type { GithubPrMentionLocation } from '@service-notification/generated/schemas/githubPrMentionLocation';
import type { GithubPrReviewState } from '@service-notification/generated/schemas/githubPrReviewState';
import type { NotifEvent } from '@service-notification/generated/schemas/notifEvent';
import type { NotificationDocumentSubType } from '@service-notification/generated/schemas/notificationDocumentSubType';
import {
  type AnyVariables,
  type Client,
  createClient,
  type DocumentInput,
  fetchExchange,
  type RequestPolicy,
  subscriptionExchange,
} from '@urql/core';
import { print } from 'graphql';
import {
  createClient as createGraphqlWsClient,
  type Client as GraphqlWsClient,
} from 'graphql-ws';
import { match } from 'ts-pattern';
import type { SoupApiItem } from './generated/schemas/soupApiItem';
import type { SoupCalendarEventSoupPropertiesField } from './generated/schemas/soupCalendarEventSoupPropertiesField';
import type { SoupCalendarEventTime } from './generated/schemas/soupCalendarEventTime';
import type { SoupPage } from './generated/schemas/soupPage';
import type { SoupProperty } from './generated/schemas/soupProperty';
import type { SoupReminderSchedule } from './generated/schemas/soupReminderSchedule';
import {
  type GraphqlEntityType,
  type GraphqlReminderScheduleType,
  type GroupedSoupInput,
  type GroupSoupQuery,
  GroupSoupDocument as GroupSoupQueryDocument,
  type GroupSoupQueryVariables,
  type SoupBackfillResult,
  type SoupInitialInput,
  type SoupInput,
  type SoupNotificationFieldsFragment,
  type SoupPropertyFieldsFragment,
  type SoupQuery,
} from './graphql/generated/graphql';
import {
  createGraphqlSoupSubscriptionsLifecycle,
  createGraphqlSoupWebSocketUrlResolver,
  SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
  shouldRetryGraphqlSoupWebSocket,
} from './graphql-soup-websocket';

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
  // urql's default ("within-url-limit") sends small documents as GET, but
  // GET on the DSS GraphQL path serves the GraphiQL IDE — only POST
  // executes. Every pre-activity document was too large to trigger this.
  preferGetMethod: false,
});

/**
 * Whether the normalized cache is active for soup GraphQL queries.
 * Browser: wasm engine in a worker. Tauri: native engine in the host
 * process (graphql_cache_plugin).
 */
export function graphqlCacheEnabled(): boolean {
  if (!isTauri() && browserCacheClientActivated) return true;
  return getBrowserTursoCacheRolloutDecision().enabled;
}

let cachedClient: Client | undefined;
let cachedCacheHost: CacheHost | undefined;
let cachedCacheCleanup: (() => void) | undefined;
let browserCacheClientActivated = false;

function fallbackAfterInitializationFailure(): void {
  const cleanup = cachedCacheCleanup;
  cachedCacheCleanup = undefined;
  cachedCacheHost = undefined;
  cachedClient = graphqlSoupClient;
  browserCacheClientActivated = false;
  try {
    cleanup?.();
  } catch {
    // Initialization-failure cleanup cannot alter GraphQL transport fallback.
  }
}

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
  const native = isTauri();
  // Only the browser Turso client is session-latched. Tauri keeps the prior
  // dynamic GraphQL transport behavior and can return to the plain client when
  // ENABLE_GRAPHQL_SOUP changes without constructing a browser resource.
  if (!native && browserCacheClientActivated && cachedClient)
    return cachedClient;
  const rollout = getBrowserTursoCacheRolloutDecision();
  if (!rollout.enabled) return graphqlSoupClient;
  if (cachedClient) return cachedClient;
  cachedClient = (() => {
    let host: CacheHost | undefined;
    let websocketClient: GraphqlWsClient | undefined;
    let unregisterHost: () => void = () => undefined;
    const subscriptionsLifecycle = createGraphqlSoupSubscriptionsLifecycle();
    const cleanup = () => {
      unregisterHost();
      // Unsubscribing emits urql teardown operations; keep the cache host
      // available until those best-effort registration removals are issued.
      subscriptionsLifecycle.dispose();
      host?.dispose();
      if (websocketClient) void websocketClient.dispose();
    };
    const onInitializationError = (error: Error) => {
      if (!host || cachedCacheHost !== host) return;
      fallbackAfterInitializationFailure();
      console.warn(
        'graphql cache async init failed; using uncached client',
        error
      );
    };
    try {
      const scope = getOrCreateCacheScope();
      host = native
        ? createTauriCacheHost({ scope, onInitializationError })
        : createWorkerCacheHost({
            scope,
            onInitializationError,
            rolloutCohort: rollout.cohort,
          });
      const resolveWebSocketUrl = createGraphqlSoupWebSocketUrlResolver({
        dssHost,
        bearerTokenAuth: ENABLE_BEARER_TOKEN_AUTH,
        getApiToken: getMacroApiToken,
        refreshCookieAuth: async () => {
          const result = await fetchToken();
          if (result.isErr()) {
            throw new Error('Unable to refresh GraphQL websocket cookie');
          }
        },
      });
      const graphqlWsClient = createGraphqlWsClient({
        url: resolveWebSocketUrl,
        retryAttempts: SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS,
        shouldRetry: shouldRetryGraphqlSoupWebSocket,
      });
      websocketClient = graphqlWsClient;
      const client = createClient({
        url: `${dssHost}/items/soup/graphql`,
        // See graphqlSoupClient: GET serves GraphiQL on this path.
        preferGetMethod: false,
        exchanges: [
          normalizedCacheExchange(host, {
            entityResolvers: {
              GraphqlUser: {
                emailThread: entityFromArgument('GraphqlSoupEmailThread', [
                  'input',
                  'threadId',
                ]),
              },
            },
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
          subscriptionExchange({
            forwardSubscription(payload, request) {
              const graphqlWsPayload = {
                query: print(request.query),
                operationName: payload.operationName,
                variables: payload.variables,
                extensions: payload.extensions,
              };
              return {
                subscribe(sink) {
                  const unsubscribe = graphqlWsClient.subscribe(
                    graphqlWsPayload,
                    sink
                  );
                  return { unsubscribe };
                },
              };
            },
          }),
          fetchExchange,
        ],
        fetch: dssGraphqlFetch,
      });
      cachedCacheHost = host;
      unregisterHost = registerCacheHost(host);
      subscriptionsLifecycle.replace(client, host);
      cachedCacheCleanup = cleanup;
      browserCacheClientActivated = !native;
      return client;
    } catch (error) {
      cleanup();
      cachedCacheHost = undefined;
      cachedCacheCleanup = undefined;
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

/** Shared entity GraphQL client used by both Soup queries and mutations. */
export const getEntityGraphqlClient = getGraphqlSoupClient;

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
type GraphqlSoupEntity = GraphqlSoupItem;
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

/** Maps GraphQL property fragments to the shared Soup property shape. */
export function mapGraphqlProperties(
  properties: SoupPropertyFieldsFragment[]
): SoupProperty[] {
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
  return match(subType)
    .with({ __typename: 'GraphqlTaskSubType' }, ({ isCompleted }) => ({
      type: 'task' as const,
      is_completed: isCompleted,
    }))
    .with({ __typename: 'GraphqlSnippetSubType' }, () => ({
      type: 'snippet' as const,
    }))
    .with({ __typename: 'GraphqlSkillSubType' }, () => ({
      type: 'skill' as const,
    }))
    .exhaustive();
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
    mentions: message.mentions ?? [],
  };
}

function normalizeChannelType(channelType: string) {
  return channelType.toLowerCase();
}

function toNotificationDocumentSubType(
  subType: string | null
): NotificationDocumentSubType | null {
  return subType
    ? ({ type: subType.toLowerCase() } as NotificationDocumentSubType)
    : null;
}

type NotifEventMember<Tag extends NotifEvent['tag']> = Extract<
  NotifEvent,
  { tag: Tag }
> & {
  content: { hasAttachments?: boolean };
};

function mapGraphqlNotificationMetadata(
  metadata: SoupNotificationFieldsFragment['metadata']
): NotifEvent {
  return match(metadata)
    .with(
      { __typename: 'GraphqlChannelMentionMetadata' },
      (metadata) =>
        ({
          tag: 'channel_mention',
          content: {
            messageId: metadata.channelMentionMessageId,
            messageContent: metadata.channelMentionMessageContent,
            hasAttachments: metadata.channelMentionHasAttachments,
            threadId: metadata.channelMentionThreadId,
            senderDisplayName: metadata.channelMentionSenderDisplayName,
            channelType:
              metadata.channelMentionChannelType.toLowerCase() as ChannelType,
            channelName: metadata.channelMentionChannelName,
            senderProfilePictureUrl:
              metadata.channelMentionSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'channel_mention'>
    )
    .with(
      { __typename: 'GraphqlDocumentMentionMetadata' },
      (metadata) =>
        ({
          tag: 'document_mention',
          content: {
            documentName: metadata.documentMentionDocumentName,
            owner: metadata.documentMentionOwner,
            fileType: metadata.documentMentionFileType,
            subType: toNotificationDocumentSubType(
              metadata.documentMentionSubType
            ),
            messageId: metadata.documentMentionMessageId,
            messageContent: metadata.documentMentionMessageContent,
            hasAttachments: metadata.documentMentionHasAttachments,
            threadId: metadata.documentMentionThreadId,
            senderDisplayName: metadata.documentMentionSenderDisplayName,
            channelType:
              metadata.documentMentionChannelType.toLowerCase() as ChannelType,
            channelName: metadata.documentMentionChannelName,
            senderProfilePictureUrl:
              metadata.documentMentionSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'document_mention'>
    )
    .with(
      { __typename: 'GraphqlMentionedInDocumentCommentMetadata' },
      (metadata) =>
        ({
          tag: 'mentioned_in_document_comment',
          content: {
            documentName: metadata.mentionedInDocumentCommentDocumentName,
            owner: metadata.mentionedInDocumentCommentOwner,
            fileType: metadata.mentionedInDocumentCommentFileType,
            subType: toNotificationDocumentSubType(
              metadata.mentionedInDocumentCommentSubType
            ),
            mentionId: metadata.mentionedInDocumentCommentMentionId,
            commentId: metadata.mentionedInDocumentCommentCommentId,
            threadId: metadata.mentionedInDocumentCommentThreadId,
            text: metadata.mentionedInDocumentCommentText,
            senderProfilePictureUrl:
              metadata.mentionedInDocumentCommentSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'mentioned_in_document_comment'>
    )
    .with(
      { __typename: 'GraphqlRepliedToDocumentCommentThreadMetadata' },
      (metadata) =>
        ({
          tag: 'replied_to_document_comment_thread',
          content: {
            documentName: metadata.repliedToDocumentCommentThreadDocumentName,
            owner: metadata.repliedToDocumentCommentThreadOwner,
            fileType: metadata.repliedToDocumentCommentThreadFileType,
            subType: toNotificationDocumentSubType(
              metadata.repliedToDocumentCommentThreadSubType
            ),
            commentId: metadata.repliedToDocumentCommentThreadCommentId,
            threadId: metadata.repliedToDocumentCommentThreadThreadId,
            text: metadata.repliedToDocumentCommentThreadText,
            senderProfilePictureUrl:
              metadata.repliedToDocumentCommentThreadSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'replied_to_document_comment_thread'>
    )
    .with(
      { __typename: 'GraphqlCommentedOnDocumentMetadata' },
      (metadata) =>
        ({
          tag: 'commented_on_document',
          content: {
            documentName: metadata.commentedOnDocumentDocumentName,
            owner: metadata.commentedOnDocumentOwner,
            fileType: metadata.commentedOnDocumentFileType,
            subType: toNotificationDocumentSubType(
              metadata.commentedOnDocumentSubType
            ),
            commentId: metadata.commentedOnDocumentCommentId,
            threadId: metadata.commentedOnDocumentThreadId,
            text: metadata.commentedOnDocumentText,
            senderProfilePictureUrl:
              metadata.commentedOnDocumentSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'commented_on_document'>
    )
    .with(
      { __typename: 'GraphqlChannelInviteMetadata' },
      (metadata) =>
        ({
          tag: 'channel_invite',
          content: {
            invitedBy: metadata.channelInviteInvitedBy,
            channelName: metadata.channelInviteChannelName,
            messageContent: metadata.channelInviteMessageContent,
            senderProfilePictureUrl:
              metadata.channelInviteSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'channel_invite'>
    )
    .with(
      { __typename: 'GraphqlChannelMessageSendMetadata' },
      (metadata) =>
        ({
          tag: 'channel_message_send',
          content: {
            sender: metadata.channelMessageSendSender,
            senderDisplayName: metadata.channelMessageSendSenderDisplayName,
            messageContent: metadata.channelMessageSendMessageContent,
            messageId: metadata.channelMessageSendMessageId,
            hasAttachments: metadata.channelMessageSendHasAttachments,
            channelType:
              metadata.channelMessageSendChannelType.toLowerCase() as ChannelType,
            channelName: metadata.channelMessageSendChannelName,
            senderProfilePictureUrl:
              metadata.channelMessageSendSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'channel_message_send'>
    )
    .with(
      { __typename: 'GraphqlChannelReplyMetadata' },
      (metadata) =>
        ({
          tag: 'channel_message_reply',
          content: {
            threadId: metadata.channelReplyThreadId,
            messageId: metadata.channelReplyMessageId,
            userId: metadata.channelReplyUserId,
            senderDisplayName: metadata.channelReplySenderDisplayName,
            messageContent: metadata.channelReplyMessageContent,
            hasAttachments: metadata.channelReplyHasAttachments,
            threadParentSenderId: metadata.channelReplyThreadParentSenderId,
            channelType:
              metadata.channelReplyChannelType.toLowerCase() as ChannelType,
            channelName: metadata.channelReplyChannelName,
            senderProfilePictureUrl:
              metadata.channelReplySenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'channel_message_reply'>
    )
    .with(
      { __typename: 'GraphqlCallStartedMetadata' },
      (metadata) =>
        ({
          tag: 'call_started',
          content: {
            channel_name: metadata.callStartedChannelName,
            sender_profile_picture_url:
              metadata.callStartedSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'call_started'>
    )
    .with(
      { __typename: 'GraphqlNewEmailMetadata' },
      (metadata) =>
        ({
          tag: 'new_email',
          content: {
            sender: metadata.newEmailSender,
            toEmail: metadata.newEmailToEmail,
            threadId: metadata.newEmailThreadId,
            subject: metadata.newEmailSubject,
            snippet: metadata.newEmailSnippet,
          },
        }) satisfies NotifEventMember<'new_email'>
    )
    .with(
      { __typename: 'GraphqlInboxReauthRequiredMetadata' },
      (metadata) =>
        ({
          tag: 'inbox_reauth_required',
          content: {
            emailAddress: metadata.inboxReauthRequiredEmailAddress,
          },
        }) satisfies NotifEventMember<'inbox_reauth_required'>
    )
    .with(
      { __typename: 'GraphqlInviteToTeamMetadata' },
      (metadata) =>
        ({
          tag: 'invite_to_team',
          content: {
            teamName: metadata.inviteToTeamTeamName,
            teamId: metadata.inviteToTeamTeamId,
            teamInviteId: metadata.inviteToTeamTeamInviteId,
            invitedBy: metadata.inviteToTeamInvitedBy,
            role: metadata.inviteToTeamRole,
            senderProfilePictureUrl:
              metadata.inviteToTeamSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'invite_to_team'>
    )
    .with(
      { __typename: 'GraphqlTaskAssignedMetadata' },
      (metadata) =>
        ({
          tag: 'task_assigned',
          content: {
            taskId: metadata.taskAssignedTaskId,
            taskName: metadata.taskAssignedTaskName,
            subType: toNotificationDocumentSubType(
              metadata.taskAssignedSubType
            ),
            assignedBy: metadata.taskAssignedAssignedBy,
            senderProfilePictureUrl:
              metadata.taskAssignedSenderProfilePictureUrl,
          },
        }) satisfies NotifEventMember<'task_assigned'>
    )
    .with(
      { __typename: 'GraphqlReminderMetadata' },
      (metadata) =>
        ({
          tag: 'reminder',
          content: {
            reminderId: metadata.reminderReminderId,
            description: metadata.reminderDescription,
          },
        }) satisfies NotifEventMember<'reminder'>
    )
    .with(
      { __typename: 'GraphqlCalendarEventReminderMetadata' },
      (metadata) =>
        ({
          tag: 'calendar_event_reminder',
          content: {
            eventId: metadata.calendarEventReminderEventId,
            occurrenceKey: metadata.calendarEventReminderOccurrenceKey,
            title: metadata.calendarEventReminderTitle,
            startsAt: metadata.calendarEventReminderStartsAt,
            endsAt: metadata.calendarEventReminderEndsAt,
            startDate: metadata.calendarEventReminderStartDate,
            timeZone: metadata.calendarEventReminderTimeZone,
            minutesBefore: metadata.calendarEventReminderMinutesBefore,
          },
        }) satisfies NotifEventMember<'calendar_event_reminder'>
    )
    .with(
      { __typename: 'GraphqlAiResponseMetadata' },
      (metadata) =>
        ({
          tag: 'ai_response',
          content: {
            summary: metadata.aiResponseSummary,
            messageId: metadata.aiResponseMessageId,
          },
        }) satisfies NotifEventMember<'ai_response'>
    )
    .with(
      { __typename: 'GraphqlGithubPrStatusChangedMetadata' },
      (metadata) =>
        ({
          tag: 'github_pr_status_changed',
          content: {
            foreignEntityId: metadata.githubPrStatusChangedForeignEntityId,
            githubKey: metadata.githubPrStatusChangedGithubKey,
            owner: metadata.githubPrStatusChangedOwner,
            repo: metadata.githubPrStatusChangedRepo,
            number: Number(metadata.githubPrStatusChangedNumber),
            url: metadata.githubPrStatusChangedUrl,
            displayName: metadata.githubPrStatusChangedDisplayName,
            title: metadata.githubPrStatusChangedTitle,
            senderGithubLogin: metadata.githubPrStatusChangedSenderGithubLogin,
            senderGithubUserId:
              metadata.githubPrStatusChangedSenderGithubUserId,
            senderGithubAvatarUrl:
              metadata.githubPrStatusChangedSenderGithubAvatarUrl,
            status:
              metadata.githubPrStatusChangedStatus.toLowerCase() as GithubPrEventStatus,
            action:
              metadata.githubPrStatusChangedAction.toLowerCase() as GithubPrEventAction,
            previousStatus:
              metadata.githubPrStatusChangedPreviousStatus?.toLowerCase() as
                | GithubPrEventStatus
                | undefined,
            headBranch: metadata.githubPrStatusChangedHeadBranch,
            baseBranch: metadata.githubPrStatusChangedBaseBranch,
            mergedAt: metadata.githubPrStatusChangedMergedAt,
          },
        }) satisfies NotifEventMember<'github_pr_status_changed'>
    )
    .with(
      { __typename: 'GraphqlGithubPrCheckRunMetadata' },
      (metadata) =>
        ({
          tag: 'github_pr_check_run',
          content: {
            foreignEntityId: metadata.githubPrCheckRunForeignEntityId,
            githubKey: metadata.githubPrCheckRunGithubKey,
            owner: metadata.githubPrCheckRunOwner,
            repo: metadata.githubPrCheckRunRepo,
            number: Number(metadata.githubPrCheckRunNumber),
            url: metadata.githubPrCheckRunUrl,
            displayName: metadata.githubPrCheckRunDisplayName,
            title: metadata.githubPrCheckRunTitle,
            senderGithubLogin: metadata.githubPrCheckRunSenderGithubLogin,
            senderGithubUserId: metadata.githubPrCheckRunSenderGithubUserId,
            senderGithubAvatarUrl:
              metadata.githubPrCheckRunSenderGithubAvatarUrl,
            checkRunGithubId: Number(metadata.githubPrCheckRunCheckRunGithubId),
            checkName: metadata.githubPrCheckRunCheckName,
            checkStatus: metadata.githubPrCheckRunCheckStatus,
            conclusion: metadata.githubPrCheckRunConclusion,
            state:
              metadata.githubPrCheckRunState.toLowerCase() as GithubPrCheckRunState,
            checkUrl: metadata.githubPrCheckRunCheckUrl,
            completedAt: metadata.githubPrCheckRunCompletedAt,
          },
        }) satisfies NotifEventMember<'github_pr_check_run'>
    )
    .with(
      { __typename: 'GraphqlGithubReviewRequestedMetadata' },
      (metadata) =>
        ({
          tag: 'github_review_requested',
          content: {
            foreignEntityId: metadata.githubReviewRequestedForeignEntityId,
            githubKey: metadata.githubReviewRequestedGithubKey,
            owner: metadata.githubReviewRequestedOwner,
            repo: metadata.githubReviewRequestedRepo,
            number: Number(metadata.githubReviewRequestedNumber),
            url: metadata.githubReviewRequestedUrl,
            displayName: metadata.githubReviewRequestedDisplayName,
            title: metadata.githubReviewRequestedTitle,
            senderGithubLogin: metadata.githubReviewRequestedSenderGithubLogin,
            senderGithubUserId:
              metadata.githubReviewRequestedSenderGithubUserId,
            senderGithubAvatarUrl:
              metadata.githubReviewRequestedSenderGithubAvatarUrl,
            requestedReviewerGithubLogin:
              metadata.githubReviewRequestedRequestedReviewerGithubLogin,
            requestedReviewerGithubUserId:
              metadata.githubReviewRequestedRequestedReviewerGithubUserId,
          },
        }) satisfies NotifEventMember<'github_review_requested'>
    )
    .with(
      { __typename: 'GraphqlGithubPrCommentMetadata' },
      (metadata) =>
        ({
          tag: 'github_pr_comment',
          content: {
            foreignEntityId: metadata.githubPrCommentForeignEntityId,
            githubKey: metadata.githubPrCommentGithubKey,
            owner: metadata.githubPrCommentOwner,
            repo: metadata.githubPrCommentRepo,
            number: Number(metadata.githubPrCommentNumber),
            url: metadata.githubPrCommentUrl,
            displayName: metadata.githubPrCommentDisplayName,
            title: metadata.githubPrCommentTitle,
            senderGithubLogin: metadata.githubPrCommentSenderGithubLogin,
            senderGithubUserId: metadata.githubPrCommentSenderGithubUserId,
            senderGithubAvatarUrl:
              metadata.githubPrCommentSenderGithubAvatarUrl,
            commentKind:
              metadata.githubPrCommentCommentKind.toLowerCase() as GithubPrCommentKind,
            commentGithubId:
              metadata.githubPrCommentCommentGithubId == null
                ? null
                : Number(metadata.githubPrCommentCommentGithubId),
            commentUrl: metadata.githubPrCommentCommentUrl,
            commentSnippet: metadata.githubPrCommentCommentSnippet,
          },
        }) satisfies NotifEventMember<'github_pr_comment'>
    )
    .with(
      { __typename: 'GraphqlGithubPrMentionMetadata' },
      (metadata) =>
        ({
          tag: 'github_pr_mention',
          content: {
            foreignEntityId: metadata.githubPrMentionForeignEntityId,
            githubKey: metadata.githubPrMentionGithubKey,
            owner: metadata.githubPrMentionOwner,
            repo: metadata.githubPrMentionRepo,
            number: Number(metadata.githubPrMentionNumber),
            url: metadata.githubPrMentionUrl,
            displayName: metadata.githubPrMentionDisplayName,
            title: metadata.githubPrMentionTitle,
            senderGithubLogin: metadata.githubPrMentionSenderGithubLogin,
            senderGithubUserId: metadata.githubPrMentionSenderGithubUserId,
            senderGithubAvatarUrl:
              metadata.githubPrMentionSenderGithubAvatarUrl,
            location:
              metadata.githubPrMentionLocation.toLowerCase() as GithubPrMentionLocation,
            commentGithubId:
              metadata.githubPrMentionCommentGithubId == null
                ? null
                : Number(metadata.githubPrMentionCommentGithubId),
            commentUrl: metadata.githubPrMentionCommentUrl,
            textSnippet: metadata.githubPrMentionTextSnippet,
          },
        }) satisfies NotifEventMember<'github_pr_mention'>
    )
    .with(
      { __typename: 'GraphqlGithubPrReviewMetadata' },
      (metadata) =>
        ({
          tag: 'github_pr_review',
          content: {
            foreignEntityId: metadata.githubPrReviewForeignEntityId,
            githubKey: metadata.githubPrReviewGithubKey,
            owner: metadata.githubPrReviewOwner,
            repo: metadata.githubPrReviewRepo,
            number: Number(metadata.githubPrReviewNumber),
            url: metadata.githubPrReviewUrl,
            displayName: metadata.githubPrReviewDisplayName,
            title: metadata.githubPrReviewTitle,
            senderGithubLogin: metadata.githubPrReviewSenderGithubLogin,
            senderGithubUserId: metadata.githubPrReviewSenderGithubUserId,
            senderGithubAvatarUrl: metadata.githubPrReviewSenderGithubAvatarUrl,
            reviewGithubId:
              metadata.githubPrReviewReviewGithubId == null
                ? null
                : Number(metadata.githubPrReviewReviewGithubId),
            reviewUrl: metadata.githubPrReviewReviewUrl,
            state:
              metadata.githubPrReviewState.toLowerCase() as GithubPrReviewState,
            reviewSnippet: metadata.githubPrReviewReviewSnippet,
          },
        }) satisfies NotifEventMember<'github_pr_review'>
    )
    .exhaustive();
}

/**
 * Rebuilds the REST notification shape from the flat GraphQL fields. The
 * server stores the event tag apart from the metadata and only REST re-joins
 * them (`UserNotificationRow::into_tagged`); GraphQL exposes a typed union, so
 * its variants are mapped to the REST adjacently-tagged metadata union here.
 * Consumers pattern-match on `notification_metadata.tag`; every GraphQL
 * notification must go through this mapper.
 */
export function mapGraphqlNotification(
  record: SoupNotificationFieldsFragment
): Omit<ApiUserNotification, 'owner_id'> {
  return {
    id: record.id,
    notification_event_type: record.eventType,
    notification_metadata: mapGraphqlNotificationMetadata(record.metadata),
    entity_id: record.entityId,
    entity_type:
      record.entityType.toLowerCase() as ApiUserNotification['entity_type'],
    sent: record.sent,
    done: record.done,
    created_at: record.createdAt,
    viewed_at: record.viewedAt ?? undefined,
    updated_at: record.updatedAt,
    sender_id: record.senderId ?? undefined,
  };
}

function mapGraphqlNotifications(
  notifications: SoupNotificationFieldsFragment[]
) {
  return notifications.map(mapGraphqlNotification);
}

/**
 * Both GraphQL entity-type enums are the REST snake_case names upper-cased, so
 * the inverse is a plain lower-case. Kept separate from the notification
 * mapper because the two enums are distinct types with different members.
 */
function mapGraphqlEntityRefType(entityType: GraphqlEntityType) {
  return entityType.toLowerCase();
}

/**
 * Rebuild the REST schedule union from the flat GraphQL fields. `remindAt`,
 * `cron`, and `timezone` are each nullable in the schema because they only
 * apply to one variant; `scheduleType` says which one is populated.
 */
function mapGraphqlReminderSchedule(entity: {
  scheduleType: GraphqlReminderScheduleType;
  remindAt: string | null;
  cron: string | null;
  timezone: string | null;
  nextRunAt: string;
}): SoupReminderSchedule {
  if (entity.scheduleType === 'RECURRING') {
    return {
      type: 'recurring',
      cron: entity.cron ?? '',
      timezone: entity.timezone ?? 'UTC',
    };
  }
  // A one-shot reminder's next run is its remindAt, so that is the right
  // stand-in on the off chance the server sends the type without the field.
  return { type: 'once', remindAt: entity.remindAt ?? entity.nextRunAt };
}

export function mapGraphqlSoupItem(item: GraphqlSoupItem): SoupApiItem | null {
  const frecency = item.frecencyScore ?? 0;

  return match(item)
    .with(
      { __typename: 'GraphqlSoupDocument' },
      (entity) =>
        ({
          tag: 'document',
          frecency_score: frecency,
          is_favorited: entity.isFavorited,
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
          is_favorited: entity.isFavorited,
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
          is_favorited: entity.isFavorited,
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
          is_favorited: entity.isFavorited,
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
          is_favorited: entity.isFavorited,
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
      { __typename: 'GraphqlSoupChannelMessage' },
      (entity) =>
        ({
          tag: 'channelThread',
          frecency_score: frecency,
          is_favorited: entity.isFavorited,
          data: {
            id: entity.id,
            attachments: [],
            channel_id: entity.channelId,
            content: entity.content ?? '',
            created_at: entity.createdAt,
            reactions: [],
            sender: {
              id: entity.senderId,
              type: 'user',
            },
            sender_id: entity.senderId,
            thread: {
              latest_reply_at: entity.effectiveUpdatedAt ?? undefined,
              preview: [],
              reply_count: entity.replyCount ?? 0,
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
          is_favorited: entity.isFavorited,
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
          is_favorited: entity.isFavorited,
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
          is_favorited: entity.isFavorited,
          data: {
            id: entity.id,
            foreignEntityId: entity.foreignEntityId,
            foreignEntitySource: entity.foreignEntitySource,
            storedForId: entity.storedForId,
            storedForAuthEntity: entity.storedForAuthEntity,
            metadata: entity.sourceMetadata,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            notifications: mapGraphqlNotifications(entity.notifications),
          },
        }) as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupCalendarEvent' },
      (entity) =>
        ({
          tag: 'calendarEvent',
          frecency_score: frecency,
          is_favorited: entity.isFavorited,
          // GraphQL omits the server-only icalUid/transparency/visibility
          // fields, so the payload cannot satisfy the full REST data type;
          // `satisfies` keeps every carried field checked against it.
          data: {
            id: entity.id,
            title: entity.calendarEventTitle,
            status: entity.calendarEventStatus,
            // The GraphQL schema types `time` as a JSON scalar of exactly
            // the REST wire shape.
            time: entity.time as SoupCalendarEventTime,
            conferenceUrl: entity.conferenceUrl ?? undefined,
            isReadOnly: entity.isReadOnly,
            ownerId: entity.ownerId,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            extra: { properties: mapGraphqlProperties(entity.properties) },
            notifications: mapGraphqlNotifications(entity.notifications),
          } satisfies Omit<
            SoupCalendarEventSoupPropertiesField,
            'icalUid' | 'transparency' | 'visibility'
          > & { notifications: ReturnType<typeof mapGraphqlNotifications> },
        }) as unknown as SoupApiItem
    )
    .with(
      { __typename: 'GraphqlSoupReminder' },
      (entity) =>
        ({
          tag: 'reminder',
          frecency_score: frecency,
          is_favorited: entity.isFavorited,
          data: {
            id: entity.id,
            description: entity.reminderDescription,
            schedule: mapGraphqlReminderSchedule(entity),
            referencedEntity: entity.referencedEntity
              ? {
                  id: entity.referencedEntity.id,
                  entityType: mapGraphqlEntityRefType(
                    entity.referencedEntity.entityType
                  ),
                  fileType: entity.referencedEntity.fileType ?? undefined,
                  subType: entity.referencedEntity.subType ?? undefined,
                }
              : undefined,
            nextRunAt: entity.nextRunAt,
            enabled: entity.enabled,
            completedAt: entity.completedAt ?? undefined,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            properties: mapGraphqlProperties(entity.properties),
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
  /** Overrides cache selection for callers such as durable backfills. */
  requestPolicy?: RequestPolicy;
};

type GraphqlSoupPageData = {
  user: {
    soup: {
      items: GraphqlSoupItem[];
      nextCursor: string | null;
    };
  };
};

/**
 * Maps a GraphQL soup response to the REST `SoupPage` shape consumed by
 * the existing soup pipeline (both the imperative fetch below and the
 * reactive urql subscriptions).
 */
export function mapGraphqlSoupPage(data: GraphqlSoupPageData): SoupPage {
  return {
    items: data.user.soup.items
      .map(mapGraphqlSoupItem)
      .filter((item): item is SoupApiItem => item !== null),
    next_cursor: data.user.soup.nextCursor ?? undefined,
  };
}

/** Maps grouped GraphQL bins to the normalized item pool used by Soup views. */
export function mapGraphqlGroupedSoupPage(
  data: GroupSoupQuery
): GraphqlGroupedSoupPage {
  const items: Record<string, SoupApiItem> = {};
  const groups = data.user.groupSoup.bins.map((bin) => {
    const itemIds = bin.items.flatMap((item) => {
      const mapped = mapGraphqlSoupItem(item);
      if (!mapped) {
        return [];
      }
      items[item.id] = mapped;
      return [item.id];
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

export type GraphqlSoupHydrationPage = {
  nextCursor: string | null;
};

/**
 * Fetches and persists a Soup page while returning only fields not marked
 * `@cacheOnly`. The generated GraphQL response type is deliberately narrowed
 * to the directive-projected cursor shape at this boundary.
 */
export async function hydrateGraphqlSoup<
  Data extends GraphqlSoupPageData,
  Variables extends AnyVariables,
>(
  document: DocumentInput<Data, Variables>,
  variables: Variables,
  options: Pick<FetchGraphqlSoupOptions, 'signal'> = {}
): Promise<GraphqlSoupHydrationPage> {
  const client = getGraphqlSoupClient();
  if (!getGraphqlCacheHost()) {
    throw new Error('GraphQL cache hydration requires an active cache');
  }
  const result = await client
    .query<SoupBackfillResult, Variables>(
      document as DocumentInput<SoupBackfillResult, Variables>,
      variables,
      {
        requestPolicy: 'network-only',
        [HYDRATE_ONLY_CONTEXT_KEY]: true,
        ...(options.signal ? { fetchOptions: { signal: options.signal } } : {}),
      }
    )
    .toPromise();

  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error('GraphQL Soup hydration returned no cursor projection');
  }
  return { nextCursor: result.data.user.soup.nextCursor };
}

/** Executes any Soup-shaped query and maps its result to the shared page type. */
export async function fetchGraphqlSoup<
  Data extends GraphqlSoupPageData,
  Variables extends AnyVariables,
>(
  document: DocumentInput<Data, Variables>,
  variables: Variables,
  options: FetchGraphqlSoupOptions = {}
): Promise<SoupPage> {
  const client = getGraphqlSoupClient();
  const useCache = graphqlCacheEnabled();
  const requestPolicy =
    options.requestPolicy ?? (useCache ? 'cache-and-network' : undefined);
  const result = await client
    .query<Data, Variables>(document, variables, {
      ...(requestPolicy ? { requestPolicy } : {}),
      ...(options.signal ? { fetchOptions: { signal: options.signal } } : {}),
    })
    .toPromise();

  if (result.error) {
    // Offline replay: a network failure falls back to the last cached page.
    if (
      options.allowOfflineFallback !== false &&
      useCache &&
      result.error.networkError
    ) {
      const cached = await client
        .query<Data, Variables>(document, variables, {
          requestPolicy: 'cache-only',
        })
        .toPromise();
      if (cached.data) return mapGraphqlSoupPage(cached.data);
    }
    throw result.error;
  }

  if (!result.data) {
    throw new Error('GraphQL Soup query returned no data');
  }

  return mapGraphqlSoupPage(result.data);
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
