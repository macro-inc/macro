import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { type RemoteParticipant, type Room, RoomEvent } from 'livekit-client';
import {
  type CallPresenceEvent,
  type CallPresenceMessage,
  createCallPresence,
  parseCallPresenceMessage,
} from '../call-presence';
import { isProgramParticipant } from '../is-program-participant';

const CALL_PRESENCE_TOPIC = 'macro.call-presence.v1';
const LEAVE_ANNOUNCEMENT_TIMEOUT_MS = 150;
const MAX_PENDING_ANNOUNCEMENTS = 32;
const MAX_RECORDED_DEPARTURES = 64;
type SoundParticipant = Pick<
  RemoteParticipant,
  'sid' | 'identity' | 'attributes'
>;
type CallPresencePacket = NonNullable<
  ReturnType<typeof parseCallPresenceMessage>
>;

/**
 * Only explicit visits make sounds. LiveKit emits identical roster removals for
 * hangups and full reconnects, so inferring intent from roster diffs is unsafe.
 * Keep this adapter inside the lazy browser-call chunk.
 */
export function createCallSounds(options: {
  room: () => Room | null;
  play: (event: CallPresenceEvent) => void;
}) {
  const presence = createCallPresence({
    play: options.play,
    createVisitId: () => crypto.randomUUID(),
  });
  let joinedRoom: Room | undefined;

  function attach(room: Room, callId: string) {
    let pending: CallPresencePacket[] = [];
    const departed = new Map<string, SoundParticipant>();
    room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== CALL_PRESENCE_TOPIC || options.room() !== room) return;
      if (room.state !== 'connected') return;
      if (payload.byteLength > 1024) return;
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      const message = parseCallPresenceMessage(value);
      if (!message) return;
      // Signaling can remove a participant before its leave packet arrives.
      const sender =
        participant ??
        [...room.remoteParticipants.values()].find(
          (peer) => peer.sid === message.senderSid
        ) ??
        departed.get(message.senderSid);
      if (!sender) {
        // Data and signaling use separate channels: a join announcement can
        // beat the roster update. Wait for that exact RTC sid, not a timer.
        if (
          message.event === 'join' &&
          pending.length < MAX_PENDING_ANNOUNCEMENTS
        )
          pending.push(message);
        return;
      }
      receive(room, message, sender);
    });
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      const messages = pending.filter(
        (message) => message.senderSid === participant.sid
      );
      pending = pending.filter(
        (message) => message.senderSid !== participant.sid
      );
      for (const message of messages) receive(room, message, participant);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      departed.set(participant.sid, {
        sid: participant.sid,
        identity: participant.identity,
        attributes: participant.attributes,
      });
      if (departed.size > MAX_RECORDED_DEPARTURES) {
        const oldest = departed.keys().next().value;
        if (oldest !== undefined) departed.delete(oldest);
      }
    });
    room.on(RoomEvent.Reconnecting, () => {
      pending = [];
      departed.clear();
    });
    room.on(RoomEvent.Reconnected, () => {
      if (options.room() !== room) return;
      pending = [];
      departed.clear();
      // Re-arm against the recovered roster without announcing another visit.
      presence.joined(callId, participantSids(room), true);
    });
  }

  function receive(
    room: Room,
    message: CallPresencePacket,
    sender: SoundParticipant
  ) {
    if (
      !isEligibleSender(room, sender, message.event) ||
      sender.sid !== message.senderSid
    )
      return;
    const deliver = () => {
      const span = Telemetry.span('call.presence.receive');
      try {
        span.setAttr('call.id', message.callId);
        span.setAttr('call.presence.event', message.event);
        span.setAttr(
          'call.presence.played',
          presence.receive(message, sender) === true
        );
      } finally {
        span.end();
      }
    };
    if (message.traceparent)
      Telemetry.remoteContext(message.traceparent).run(deliver);
    else deliver();
  }

  function isEligibleSender(
    room: Room,
    participant: SoundParticipant,
    event: CallPresenceEvent
  ): boolean {
    if (options.room() !== room || room.state !== 'connected') return false;
    if (participant.identity === room.localParticipant.identity) return false;
    if (isProgramParticipant(participant.attributes)) return false;
    const current = room.remoteParticipants.get(participant.identity);
    return current ? current.sid === participant.sid : event === 'leave';
  }

  function participantSids(room: Room) {
    return [...room.remoteParticipants.values()].map(
      (participant) => participant.sid
    );
  }

  async function publish(room: Room, message: CallPresenceMessage) {
    const span = Telemetry.span('call.presence.send');
    span.setAttr('call.id', message.callId);
    span.setAttr('call.presence.event', message.event);
    try {
      await room.localParticipant.publishData(
        new TextEncoder().encode(
          JSON.stringify({
            ...message,
            senderSid: room.localParticipant.sid,
            traceparent: span.traceparent(),
          })
        ),
        {
          reliable: true,
          topic: CALL_PRESENCE_TOPIC,
          // A late join announcement must not notify someone who joined later.
          destinationIdentities: [...room.remoteParticipants.keys()],
        }
      );
    } catch {
      // Presence cues are best-effort and must never fail a join or hangup.
      span.error('Call presence announcement failed');
    } finally {
      span.end();
    }
  }

  function joined(room: Room, callId: string, recovery: boolean) {
    if (joinedRoom === room) return;
    joinedRoom = room;
    const message = presence.joined(callId, participantSids(room), recovery);
    if (message) fireAndForget(publish(room, message), 'call-sounds');
  }

  async function leaving(room: Room | null) {
    const message = presence.left();
    joinedRoom = undefined;
    if (!message || !room || room.state !== 'connected') return;
    // Give the reliable channel a small bounded head start over RTC teardown.
    // A blocked data channel must never hold the user's hangup hostage.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        publish(room, message),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, LEAVE_ANNOUNCEMENT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    attach,
    joined,
    leaving,
    abandon: () => {
      joinedRoom = undefined;
      presence.clear();
    },
  };
}
