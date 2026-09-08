import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { handleAgentSessionQueue } from '@queries/agent-session/queue-sync';
import {
  AGENT_SESSION_LOG_EVENT,
  AGENT_SESSION_QUEUE_EVENT,
  AGENT_SESSION_RENAMED_EVENT,
  type AgentSessionLogEvent,
  type AgentSessionQueueEvent,
  type AgentSessionRenamedEvent,
} from '@queries/agent-session/realtime-protocol';
import { handleAgentSessionLog } from '@queries/agent-session/session-fold';
import { handleAgentSessionRenamed } from '@queries/agent-session/session-metadata-sync';
import {
  handleCommsAttachment,
  handleCommsMessage,
  handleCommsReaction,
} from '@queries/channel/sync';
import { handleCommsTyping } from '@queries/channel/typing';
import { invalidateContacts } from '@queries/contacts/contacts';
import { handleRefreshEmail } from '@queries/email/sync';
import { invalidateFavorites } from '@queries/favorites/favorites';
import {
  applyNotificationStatusUpdate,
  notificationStatusUpdatePayloadSchema,
} from '@queries/notification/user-notifications';
import { invalidateAllProperties } from '@queries/properties/tags';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { handleTaskDuplicateMatchesUpdated } from '@queries/storage/task-duplicates';
import { handleRefreshCalendar } from '../calendar/sync';
// Side-effect import: registers the scheduled-action live-update websocket
// listener. Must be imported somewhere that always loads on app start — this
// provider is guaranteed to mount alongside the other sync handlers.
import '@queries/agent-schedule/sync';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
} from '@service-connection/websocket';
import type { Accessor, ParentProps } from 'solid-js';
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
  createConnectionWebsocketEffect((data) => {
    match(data)
      .with({ type: 'contacts_invalidation' }, () => {
        invalidateContacts();
      })
      .with({ type: 'comms_message' }, () => {
        withParsedWebsocketPayload(data.type, data.data, handleCommsMessage);
      })
      // One frame appended to a live agent session's log. Routed to the
      // channel's fold rather than to any cache: the frame is not a message,
      // it is a step towards one, and only the fold knows which.
      .with({ type: AGENT_SESSION_LOG_EVENT }, () => {
        withParsedWebsocketPayload<AgentSessionLogEvent>(
          data.type,
          data.data,
          handleAgentSessionLog
        );
      })
      .with({ type: AGENT_SESSION_RENAMED_EVENT }, () => {
        withParsedWebsocketPayload<AgentSessionRenamedEvent>(
          data.type,
          data.data,
          handleAgentSessionRenamed
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
      .with({ type: 'comms_reaction' }, () => {
        withParsedWebsocketPayload(data.type, data.data, handleCommsReaction);
      })
      .with({ type: 'comms_attachment' }, () => {
        withParsedWebsocketPayload(data.type, data.data, handleCommsAttachment);
      })
      .with({ type: 'comms_typing' }, () => {
        const userId = props.userId();
        if (!userId) return;
        withParsedWebsocketPayload<Parameters<typeof handleCommsTyping>[0]>(
          data.type,
          data.data,
          (payload) => {
            handleCommsTyping(payload, userId);
          }
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
