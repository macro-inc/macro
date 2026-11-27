import {
  ConnectionState,
  DataPacket_Kind,
  RemoteParticipant,
  Room,
  RoomEvent,
} from 'livekit-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCallSounds } from '../primitives/call-sounds';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('ignores transport churn, local identities, program participants, and stale rooms', () => {
  const room = new Room();
  room.state = ConnectionState.Connected;
  room.localParticipant.identity = 'local-user';
  vi.spyOn(room.localParticipant, 'publishData').mockResolvedValue(undefined);
  const remote = new RemoteParticipant(
    room.engine.client,
    'remote-sid',
    'remote-user'
  );
  const self = new RemoteParticipant(
    room.engine.client,
    'self-sid',
    'local-user'
  );
  const program = new RemoteParticipant(
    room.engine.client,
    'program-sid',
    'program',
    undefined,
    undefined,
    { 'macro.program': 'true' }
  );
  for (const participant of [remote, self, program]) {
    room.remoteParticipants.set(participant.identity, participant);
  }
  let currentRoom: Room | null = room;
  const play = vi.fn();
  const sounds = createCallSounds({ room: () => currentRoom, play });
  sounds.attach(room, 'call-1');
  sounds.joined(room, 'call-1', false);
  play.mockClear();
  vi.advanceTimersByTime(2_000);

  for (let index = 0; index < 10; index += 1) {
    room.emit(RoomEvent.ParticipantDisconnected, remote);
    room.emit(RoomEvent.ParticipantConnected, remote);
    room.emit(RoomEvent.Reconnecting);
    room.emit(RoomEvent.Reconnected);
  }
  expect(play).not.toHaveBeenCalled();

  for (const participant of [remote, self, program]) {
    room.emit(
      RoomEvent.DataReceived,
      new TextEncoder().encode(
        JSON.stringify({
          callId: 'call-1',
          visitId: 'visit-1',
          event: 'join',
          senderSid: participant.sid,
        })
      ),
      participant,
      DataPacket_Kind.RELIABLE,
      'macro.call-presence.v1'
    );
  }
  expect(play).not.toHaveBeenCalled();

  const newcomer = new RemoteParticipant(
    room.engine.client,
    'new-sid',
    'new-user'
  );
  room.remoteParticipants.set(newcomer.identity, newcomer);
  const payload = new TextEncoder().encode(
    JSON.stringify({
      callId: 'call-1',
      visitId: 'new-visit',
      event: 'join',
      senderSid: newcomer.sid,
    })
  );
  room.emit(
    RoomEvent.DataReceived,
    payload,
    newcomer,
    DataPacket_Kind.RELIABLE,
    'macro.call-presence.v1'
  );
  room.emit(
    RoomEvent.DataReceived,
    payload,
    newcomer,
    DataPacket_Kind.RELIABLE,
    'macro.call-presence.v1'
  );
  expect(play).toHaveBeenCalledExactlyOnceWith('join');

  currentRoom = null;
  vi.advanceTimersByTime(2_000);
  room.emit(
    RoomEvent.DataReceived,
    new TextEncoder().encode(
      JSON.stringify({
        callId: 'call-1',
        visitId: 'later-visit',
        event: 'join',
        senderSid: newcomer.sid,
      })
    ),
    newcomer,
    DataPacket_Kind.RELIABLE,
    'macro.call-presence.v1'
  );
  expect(play).toHaveBeenCalledTimes(1);
  room.removeAllListeners();
});
