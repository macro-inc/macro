import { match } from 'ts-pattern';
import type {
  SessionIdentity,
  ThreadOrigin,
} from '../../../generated/storage/types.gen';
import { AgentSession } from '../../entities/agent-sessions/agent-session';
import { Channel } from '../../entities/channels/channel';
import { Message } from '../../entities/channels/message';
import { Thread } from '../../entities/channels/thread';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type AgentSessionEvent = Extract<
  MacroEvent,
  { event_type: `agent_session.${string}` }
>;

/** The channel thread a session was opened from, when it was. */
function originHandles(
  client: MacroClient,
  origin: ThreadOrigin | null | undefined,
) {
  return origin
    ? {
        channel: Channel.byId(client, origin.channel_id),
        thread: new Thread(client, origin.channel_id, origin.thread_id),
      }
    : { channel: undefined, thread: undefined };
}

/** Handles every lifecycle event carries: the session, its owner, its origin. */
function sessionHandles(client: MacroClient, identity: SessionIdentity) {
  return {
    session: AgentSession.byId(client, identity.session_id),
    owner: User.byId(client, identity.owner_id),
    ...originHandles(client, identity.origin),
  };
}

/**
 * The magic-chip message a turn renders into, when one was posted. Lives in
 * the origin channel, so a session with no origin never has one.
 */
function announcementHandle(
  client: MacroClient,
  identity: SessionIdentity,
  announcementMessageId: string | null | undefined,
) {
  return identity.origin && announcementMessageId
    ? Message.byId(client, identity.origin.channel_id, announcementMessageId)
    : undefined;
}

function actorHandle(client: MacroClient, actor: string | null | undefined) {
  return actor ? User.byId(client, actor) : undefined;
}

/** Attach SDK entity handles to an agent-session lifecycle webhook event. */
export function hydrateAgentSessionEvent(
  client: MacroClient,
  event: AgentSessionEvent,
) {
  return match(event)
    .with({ event_type: 'agent_session.opened' }, ({ metadata }) => ({
      event_type: 'agent_session.opened' as const,
      metadata,
      ...sessionHandles(client, metadata.identity),
    }))
    .with({ event_type: 'agent_session.turn_started' }, ({ metadata }) => ({
      event_type: 'agent_session.turn_started' as const,
      metadata,
      ...sessionHandles(client, metadata.identity),
      actor: actorHandle(client, metadata.actor),
      announcement: announcementHandle(
        client,
        metadata.identity,
        metadata.announcement_message_id,
      ),
    }))
    .with({ event_type: 'agent_session.turn_ended' }, ({ metadata }) => ({
      event_type: 'agent_session.turn_ended' as const,
      metadata,
      ...sessionHandles(client, metadata.identity),
      actor: actorHandle(client, metadata.actor),
      announcement: announcementHandle(
        client,
        metadata.identity,
        metadata.announcement_message_id,
      ),
    }))
    .with({ event_type: 'agent_session.settled' }, ({ metadata }) => ({
      event_type: 'agent_session.settled' as const,
      metadata,
      ...sessionHandles(client, metadata.identity),
      actor: actorHandle(client, metadata.last_turn?.actor),
      announcement: announcementHandle(
        client,
        metadata.identity,
        metadata.last_turn?.announcement_message_id,
      ),
    }))
    .with(
      { event_type: 'agent_session.waiting_for_input' },
      ({ metadata }) => ({
        event_type: 'agent_session.waiting_for_input' as const,
        metadata,
        ...sessionHandles(client, metadata.identity),
        announcement: announcementHandle(
          client,
          metadata.identity,
          metadata.announcement_message_id,
        ),
      }),
    )
    .with({ event_type: 'agent_session.input_received' }, ({ metadata }) => ({
      event_type: 'agent_session.input_received' as const,
      metadata,
      ...sessionHandles(client, metadata.identity),
    }))
    .with({ event_type: 'agent_session.stopped' }, ({ metadata }) => ({
      event_type: 'agent_session.stopped' as const,
      metadata,
      ...sessionHandles(client, metadata.identity),
      actor: actorHandle(client, metadata.turn_in_flight?.actor),
      announcement: announcementHandle(
        client,
        metadata.identity,
        metadata.turn_in_flight?.announcement_message_id,
      ),
    }))
    .with({ event_type: 'agent_session.renamed' }, ({ metadata }) => ({
      event_type: 'agent_session.renamed' as const,
      metadata,
      ...sessionHandles(client, metadata.identity),
    }))
    .with({ event_type: 'agent_session.deleted' }, ({ metadata }) => ({
      event_type: 'agent_session.deleted' as const,
      metadata,
      ...sessionHandles(client, metadata.identity),
    }))
    .exhaustive();
}
