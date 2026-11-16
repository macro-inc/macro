import { match } from 'ts-pattern';
import { CallRecord } from '../../entities/calls/call-record';
import { Channel } from '../../entities/channels/channel';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type CallRecordEvent = Extract<
  MacroEvent,
  { event_type: `call.record_${string}` }
>;

/** Attach call record, channel and actor handles to a call-record event. */
export function hydrateCallRecordEvent(
  client: MacroClient,
  event: CallRecordEvent,
) {
  const actor = (id: string | null | undefined) =>
    id ? User.byId(client, id) : undefined;

  return match(event)
    .with({ event_type: 'call.record_updated' }, ({ metadata }) => ({
      event_type: 'call.record_updated' as const,
      metadata,
      call: CallRecord.byId(client, metadata.call_id),
      channel: metadata.channel_id
        ? Channel.byId(client, metadata.channel_id)
        : undefined,
      actor: actor(metadata.actor_user_id),
    }))
    .with({ event_type: 'call.record_deleted' }, ({ metadata }) => ({
      event_type: 'call.record_deleted' as const,
      metadata,
      call: CallRecord.byId(client, metadata.call_id),
      channel: Channel.byId(client, metadata.channel_id),
      actor: actor(metadata.actor_user_id),
    }))
    .with({ event_type: 'call.record_imported' }, ({ metadata }) => ({
      event_type: 'call.record_imported' as const,
      metadata,
      call: CallRecord.byId(client, metadata.call_id),
    }))
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown call record event', unknown);
      return undefined;
    });
}
