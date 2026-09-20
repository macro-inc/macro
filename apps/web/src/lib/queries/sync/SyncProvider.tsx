import { AgentSession } from '@core/agent-session/AgentSession';
import { noteSessionActivity } from '@core/agent-session/session-turn';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import { handleAgentSessionChanges } from '@queries/agent-session/changes-sync';
import { handleAgentSessionQueue } from '@queries/agent-session/queue-sync';
import {
  AGENT_SESSION_CHANGES_EVENT,
  AGENT_SESSION_LOG_EVENT,
  AGENT_SESSION_QUEUE_EVENT,
  AGENT_SESSION_RENAMED_EVENT,
  AGENT_SESSION_UPDATED_EVENT,
  type AgentSessionChangesEvent,
  type AgentSessionLogEvent,
  type AgentSessionQueueEvent,
  type AgentSessionRenamedEvent,
  type AgentSessionUpdatedEvent,
} from '@queries/agent-session/realtime-protocol';
import {
  handleAgentSessionRenamed,
  handleAgentSessionUpdated,
  invalidateAgentSessionMetadata,
} from '@queries/agent-session/session-metadata-sync';
import {
  handleChannelPictureChanged,
  invalidateChannelPictures,
} from '@queries/channel/picture';
import { invalidateContacts } from '@queries/contacts/contacts';
import { handleRefreshEmail } from '@queries/email/sync';
import { invalidateFavorites } from '@queries/favorites/favorites';
import { handleMessageEvent } from '@queries/messages/sync';
import {
  applyNotificationStatusUpdate,
  notificationStatusUpdatePayloadSchema,
} from '@queries/notification/user-notifications';
import { invalidateAllProperties } from '@queries/properties/tags';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import {
  handlePullRequestUpdated,
  invalidatePullRequestMentions,
} from '@queries/storage/pr-mention-sync';
import { handleTaskDuplicateMatchesUpdated } from '@queries/storage/task-duplicates';
import { handleRefreshCalendar } from '../calendar/sync';
// Side-effect import: registers the scheduled-action live-update websocket
// listener. Must be imported somewhere that always loads on app start — this
// provider is guaranteed to mount alongside the other sync handlers.
import '@queries/agent-schedule/sync';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
  ws,
} from '@service-connection/websocket';
import { type Accessor, onCleanup, type ParentProps } from 'solid-js';
import { match } from 'ts-pattern';

type SyncProviderProps = ParentProps<{
  userId: Accessor<string | undefined>;
}>;

function withParsedWebsocketPayload<T>(
  type: string,
  payload: unknown,
  handle: (payload: T) => void
): void {
  const parsedPayload = parseWebsocketPayload<T>(type, payload);
  if (parsedPayload === undefined) return;

  handle(parsedPayload);
}

export function QuerySyncProvider(props: SyncProviderProps) {
  ws.addEventListener(WebsocketEvent.Open, invalidateChannelPictures);
  onCleanup(() =>
    ws.removeEventListener(WebsocketEvent.Open, invalidateChannelPictures)
  );
  // Also cover the first connection: a lookup can finish before the socket opens.
  ws.addEventListener(WebsocketEvent.Open, invalidateAgentSessionMetadata);
  onCleanup(() =>
    ws.removeEventListener(WebsocketEvent.Open, invalidateAgentSessionMetadata)
  );
  ws.addEventListener(WebsocketEvent.Open, invalidatePullRequestMentions);
  onCleanup(() =>
    ws.removeEventListener(WebsocketEvent.Open, invalidatePullRequestMentions)
  );

  createConnectionWebsocketEffect((data) => {
    match(data)
      .with({ type: 'github_pull_request_updated' }, () => {
        withParsedWebsocketPayload(data.type, data.data, (payload) => {
          void handlePullRequestUpdated(payload);
        });
      })
      .with({ type: 'contacts_invalidation' }, () => {
        invalidateContacts();
      })
      .with({ type: 'message_update' }, () => {
        withParsedWebsocketPayload<Parameters<typeof handleMessageEvent>[0]>(
          data.type,
          data.data,
          (event) => handleMessageEvent(event, props.userId())
        );
      })
      .with({ type: 'comms_channel_picture' }, () => {
        withParsedWebsocketPayload(
          data.type,
          data.data,
          handleChannelPictureChanged
        );
      })
      // One frame appended to a live agent session's log. Routed to the
      // channel's fold rather than to any cache: the frame is not a message,
      // it is a step towards one, and only the fold knows which.
      .with({ type: AGENT_SESSION_LOG_EVENT }, () => {
        withParsedWebsocketPayload<AgentSessionLogEvent>(
          data.type,
          data.data,
          (event) => {
            AgentSession.ingest(event);
            if (!AgentSession.get(event.agentSessionId)) {
              noteSessionActivity(event.agentSessionId);
            }
          }
        );
      })
      .with({ type: AGENT_SESSION_UPDATED_EVENT }, () => {
        withParsedWebsocketPayload<AgentSessionUpdatedEvent>(
          data.type,
          data.data,
          handleAgentSessionUpdated
        );
      })
      .with({ type: AGENT_SESSION_RENAMED_EVENT }, () => {
        withParsedWebsocketPayload<AgentSessionRenamedEvent>(
          data.type,
          data.data,
          handleAgentSessionRenamed
        );
      })
      // A session's captured changes moved (capture started, landed, or
      // failed). The event carries no body; the changes summary refetches.
      .with({ type: AGENT_SESSION_CHANGES_EVENT }, () => {
        withParsedWebsocketPayload<AgentSessionChangesEvent>(
          data.type,
          data.data,
          (event) => {
            void handleAgentSessionChanges(event);
          }
        );
      })
      // A session's whole action queue after a change. Full snapshot every
      // time: once one has arrived on this socket, the socket is the queue's
      // only writer and the last event wins unconditionally.
      .with({ type: AGENT_SESSION_QUEUE_EVENT }, () => {
        withParsedWebsocketPayload<AgentSessionQueueEvent>(
          data.type,
          data.data,
          handleAgentSessionQueue
        );
      })
      .with({ type: 'notification_status_updated' }, () => {
        if (isFeatureEnabled(enableGraphqlSoup)) return;
        const result = notificationStatusUpdatePayloadSchema.safeParse(
          data.data
        );
        if (!result.success) {
          console.warn(
            'Malformed notification status update payload',
            data.data
          );
          return;
        }
        applyNotificationStatusUpdate(result.data);
      })
      .with({ type: 'refresh_email' }, () => {
        withParsedWebsocketPayload(data.type, data.data, handleRefreshEmail);
      })
      .with({ type: 'refresh_calendar' }, () => {
        withParsedWebsocketPayload(data.type, data.data, handleRefreshCalendar);
      })
      // Signup seeding is fire-and-forget, so refresh Soup and the provisioned
      // properties and favorites when it finishes.
      .with({ type: 'starter_docs_initialized' }, () => {
        void invalidateFavorites();
        invalidateAllProperties();
        invalidateAllSoup();
      })
      .with({ type: 'task_duplicate_matches_updated' }, () => {
        withParsedWebsocketPayload(
          data.type,
          data.data,
          handleTaskDuplicateMatchesUpdated
        );
      })
      .otherwise(() => {});
  });

  return props.children;
}
