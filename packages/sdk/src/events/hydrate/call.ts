import { match } from 'ts-pattern';
import { CallRecord } from '../../entities/calls/call-record';
import { Channel } from '../../entities/channels/channel';
import { Meeting } from '../../entities/meetings/meeting';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type CallEvent = Extract<MacroEvent, { event_type: `call.${string}` }>;

/** Attach call, channel, meeting, and actor handles to call notifications. */
export function hydrateCallEvent(client: MacroClient, event: CallEvent) {
  const handles = (metadata: CallEvent['metadata']) => ({
    call: CallRecord.byId(client, metadata.call_id),
    channel: metadata.channel_id ? Channel.byId(client, metadata.channel_id) : undefined,
    meeting: metadata.meeting_id ? Meeting.byId(client, metadata.meeting_id) : undefined,
    creator: metadata.created_by ? User.byId(client, metadata.created_by) : undefined,
    user: metadata.user_id ? User.byId(client, metadata.user_id) : undefined,
    inviter: metadata.invited_by ? User.byId(client, metadata.invited_by) : undefined,
  });

  return match(event)
    .with({ event_type: 'call.started' }, ({ metadata }) => ({ event_type: 'call.started' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.ended' }, ({ metadata }) => ({ event_type: 'call.ended' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.participant_joined' }, ({ metadata }) => ({ event_type: 'call.participant_joined' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.participant_left' }, ({ metadata }) => ({ event_type: 'call.participant_left' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.recording_ready' }, ({ metadata }) => ({ event_type: 'call.recording_ready' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.summarized' }, ({ metadata }) => ({ event_type: 'call.summarized' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.ringing' }, ({ metadata }) => ({ event_type: 'call.ringing' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.answered' }, ({ metadata }) => ({ event_type: 'call.answered' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.declined' }, ({ metadata }) => ({ event_type: 'call.declined' as const, metadata, ...handles(metadata) }))
    .with({ event_type: 'call.invited' }, ({ metadata }) => ({ event_type: 'call.invited' as const, metadata, ...handles(metadata) }))
    .exhaustive();
}
