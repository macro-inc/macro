import { match } from 'ts-pattern';
import type { ChannelShareEntityType } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { AgentSession } from '../agent-sessions/agent-session';
import type { CalendarEvent } from '../calendar/event';
import type { CallRecord } from '../calls/call-record';
import type { Database } from '../databases/database';
import type { Document } from '../documents/document';
import type { EmailThread } from '../email/thread';
import type { ExternalChat } from '../external-chat/chat';
import type { Form } from '../forms/form';
import type { Project } from '../projects/project';
import type { Channel } from './channel';

/** An item {@link Channel.share} can share with a channel's members. */
export type ChannelShareable =
  | AgentSession
  | CalendarEvent
  | CallRecord
  | Database
  | Document
  | EmailThread
  | ExternalChat
  | Form
  | Project;

/** The stored type a channel grant is written for. */
function shareType(item: ChannelShareable): ChannelShareEntityType {
  return match(item.entityType)
    .with('agent_session', () => 'agent_session' as const)
    .with('calendar_event', () => 'calendar_event' as const)
    .with('call', () => 'call' as const)
    .with('database', () => 'database' as const)
    .with('document', () => 'document' as const)
    .with('email_thread', () => 'thread' as const)
    .with('external_chat', () => 'external_chat' as const)
    .with('form', () => 'form' as const)
    .with('project', () => 'project' as const)
    .exhaustive();
}

/** @internal */
export async function shareWithChannel(
  client: MacroClient,
  channel: Channel,
  item: ChannelShareable,
): Promise<void> {
  unwrap(
    await client.storage.shareWithChannel({
      path: { channel_id: channel.id },
      body: { entityType: shareType(item), entityId: item.id },
    }),
  );
}
