import { Telemetry } from '@macro-inc/observability';
import {
  ConnectionState,
  RemoteParticipant,
  Room,
  RoomEvent,
} from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCallPresenceMessage } from '../call-presence';
import { createCallSounds } from '../primitives/call-sounds';

const TOPIC = 'macro.call-presence.v1';

describe('call sound transport', () => {
  let room: Room;
  let currentRoom: Room | null;
  let sounds: ReturnType<typeof createCallSounds>;
  const play = vi.fn();

  beforeEach(() => {
    play.mockClear();
    room = new Room();
    room.state = ConnectionState.Connected;
    room.localParticipant.identity = 'self';
    room.localParticipant.sid = 'self-1';
    currentRoom = room;
    sounds = createCallSounds({ room: () => currentRoom, play });
    sounds.attach(room, 'call-1');
    vi.spyOn(room.localParticipant, 'publishData').mockResolvedValue();
  });

  afterEach(() => {
    room.removeAllListeners();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ignores roster removals and repopulation during local and remote recovery', () => {
    const peer = new RemoteParticipant(room.engine.client, 'peer-1', 'peer');
    room.remoteParticipants.set(peer.identity, peer);
    sounds.joined(room, 'call-1', false);
    play.mockClear();
    // LiveKit emits removals before the local Reconnecting event.
    room.emit(RoomEvent.ParticipantDisconnected, peer);
    room.state = ConnectionState.Reconnecting;
    room.emit(RoomEvent.Reconnecting);
    room.emit(RoomEvent.ParticipantConnected, peer);
    room.state = ConnectionState.Connected;
    room.emit(RoomEvent.Reconnected);
    room.emit(RoomEvent.ParticipantDisconnected, peer);
    room.emit(RoomEvent.ParticipantConnected, peer);
    expect(play).not.toHaveBeenCalled();
    expect(room.localParticipant.publishData).toHaveBeenCalledTimes(1);
  });

  it('announces one join for repeated completion of the same connection', () => {
    sounds.joined(room, 'call-1', false);
    sounds.joined(room, 'call-1', false);
    expect(play.mock.calls).toEqual([['join']]);
    expect(room.localParticipant.publishData).toHaveBeenCalledTimes(1);
  });

  it('plays a leave packet after signaling removes its participant', () => {
    const peer = new RemoteParticipant(room.engine.client, 'peer-1', 'peer');
    room.remoteParticipants.set(peer.identity, peer);
    sounds.joined(room, 'call-1', false);
    play.mockClear();
    room.remoteParticipants.delete(peer.identity);
    room.emit(RoomEvent.ParticipantDisconnected, peer);
    const payload = new TextEncoder().encode(
      JSON.stringify({
        callId: 'call-1',
        visitId: 'peer-visit',
        event: 'leave',
        senderSid: peer.sid,
      })
    );
    room.emit(RoomEvent.DataReceived, payload, undefined, undefined, TOPIC);
    expect(play.mock.calls).toEqual([['leave']]);
    room.state = ConnectionState.Reconnecting;
    room.emit(RoomEvent.Reconnecting);
    room.state = ConnectionState.Connected;
    room.emit(RoomEvent.Reconnected);
    play.mockClear();
    room.emit(RoomEvent.DataReceived, payload, undefined, undefined, TOPIC);
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores a delayed old leave after that identity rejoins', () => {
    const peer = new RemoteParticipant(room.engine.client, 'peer-1', 'peer');
    room.remoteParticipants.set(peer.identity, peer);
    sounds.joined(room, 'call-1', false);
    room.remoteParticipants.delete(peer.identity);
    room.emit(RoomEvent.ParticipantDisconnected, peer);
    room.remoteParticipants.set(
      peer.identity,
      new RemoteParticipant(room.engine.client, 'peer-2', 'peer')
    );
    play.mockClear();
    room.emit(
      RoomEvent.DataReceived,
      new TextEncoder().encode(
        JSON.stringify({
          callId: 'call-1',
          visitId: 'peer-visit',
          event: 'leave',
          senderSid: peer.sid,
        })
      ),
      undefined,
      undefined,
      TOPIC
    );
    expect(play).not.toHaveBeenCalled();
  });

  it('plays explicit peer events but rejects self, programs, wrong topics, and stale rooms', () => {
    const peer = new RemoteParticipant(room.engine.client, 'peer-1', 'peer');
    const program = new RemoteParticipant(
      room.engine.client,
      'program-1',
      'program',
      undefined,
      undefined,
      { 'macro.program': 'true' }
    );
    room.remoteParticipants.set(peer.identity, peer);
    room.remoteParticipants.set(program.identity, program);
    sounds.joined(room, 'call-1', false);
    play.mockClear();
    const payload = new TextEncoder().encode(
      JSON.stringify({
        callId: 'call-1',
        visitId: 'peer-visit',
        event: 'leave',
        senderSid: peer.sid,
      })
    );
    room.emit(RoomEvent.DataReceived, payload, peer, undefined, 'unrelated');
    room.emit(RoomEvent.DataReceived, payload, program, undefined, TOPIC);
    room.emit(
      RoomEvent.DataReceived,
      payload,
      new RemoteParticipant(room.engine.client, 'self-1', 'self'),
      undefined,
      TOPIC
    );
    room.state = ConnectionState.Reconnecting;
    room.emit(RoomEvent.DataReceived, payload, peer, undefined, TOPIC);
    room.state = ConnectionState.Connected;
    room.emit(
      RoomEvent.DataReceived,
      new TextEncoder().encode('{'),
      peer,
      undefined,
      TOPIC
    );
    expect(play).not.toHaveBeenCalled();
    room.emit(RoomEvent.DataReceived, payload, peer, undefined, TOPIC);
    expect(play.mock.calls).toEqual([['leave']]);
    currentRoom = new Room();
    room.emit(
      RoomEvent.DataReceived,
      new TextEncoder().encode(
        JSON.stringify({
          callId: 'call-1',
          visitId: 'another-visit',
          event: 'leave',
          senderSid: peer.sid,
        })
      ),
      peer,
      undefined,
      TOPIC
    );
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('resolves a missing SDK sender against the current roster', () => {
    const peer = new RemoteParticipant(room.engine.client, 'peer-1', 'peer');
    room.remoteParticipants.set(peer.identity, peer);
    sounds.joined(room, 'call-1', false);
    play.mockClear();
    const payload = new TextEncoder().encode(
      JSON.stringify({
        callId: 'call-1',
        visitId: 'peer-visit',
        event: 'leave',
        senderSid: peer.sid,
      })
    );
    room.emit(RoomEvent.DataReceived, payload, undefined, undefined, TOPIC);
    expect(play.mock.calls).toEqual([['leave']]);
  });

  it('waits for the roster when a join packet beats signaling', () => {
    sounds.joined(room, 'call-1', false);
    play.mockClear();
    const peer = new RemoteParticipant(room.engine.client, 'peer-1', 'peer');
    const payload = new TextEncoder().encode(
      JSON.stringify({
        callId: 'call-1',
        visitId: 'peer-visit',
        event: 'join',
        senderSid: peer.sid,
      })
    );
    room.emit(RoomEvent.DataReceived, payload, undefined, undefined, TOPIC);
    expect(play).not.toHaveBeenCalled();
    room.remoteParticipants.set(peer.identity, peer);
    room.emit(RoomEvent.ParticipantConnected, peer);
    expect(play.mock.calls).toEqual([['join']]);
  });

  it('clears an abandoned recovery before a later manual join', async () => {
    sounds.joined(room, 'call-1', false);
    sounds.joined(room, 'call-1', true);
    sounds.abandon();
    expect(play.mock.calls).toEqual([['join']]);
    sounds.joined(room, 'call-1', false);
    await sounds.leaving(null);
    expect(play.mock.calls).toEqual([['join'], ['join'], ['leave']]);
  });

  it('carries the sending trace across the presence data channel', () => {
    const traceparent =
      '00-11111111111111111111111111111111-2222222222222222-01';
    const span = Telemetry.span('test');
    vi.spyOn(span, 'traceparent').mockReturnValue(traceparent);
    vi.spyOn(Telemetry, 'span').mockReturnValue(span);
    const remoteContext = vi.spyOn(Telemetry, 'remoteContext');
    const peer = new RemoteParticipant(room.engine.client, 'peer-1', 'peer');
    room.remoteParticipants.set(peer.identity, peer);
    sounds.joined(room, 'call-1', false);
    const payload = vi.mocked(room.localParticipant.publishData).mock
      .calls[0][0];
    const message = parseCallPresenceMessage(
      JSON.parse(new TextDecoder().decode(payload))
    );
    expect(message?.traceparent).toBe(traceparent);
    room.emit(
      RoomEvent.DataReceived,
      new TextEncoder().encode(
        JSON.stringify({
          ...message,
          event: 'leave',
          senderSid: peer.sid,
        })
      ),
      peer,
      undefined,
      TOPIC
    );
    expect(remoteContext).toHaveBeenCalledWith(traceparent);
  });
  it('bounds a blocked leave announcement and never repeats the self leave', async () => {
    vi.useFakeTimers();
    sounds.joined(room, 'call-1', false);
    vi.mocked(room.localParticipant.publishData).mockImplementation(
      () => new Promise(() => {})
    );
    const leaving = sounds.leaving(room);
    expect(play.mock.calls).toEqual([['join'], ['leave']]);
    await vi.advanceTimersByTimeAsync(150);
    await leaving;
    await sounds.leaving(room);
    expect(play.mock.calls).toEqual([['join'], ['leave']]);
  });

  it('does not fail a join or leave when announcement delivery fails', async () => {
    vi.mocked(room.localParticipant.publishData).mockRejectedValue(
      new Error('offline')
    );
    sounds.joined(room, 'call-1', false);
    await sounds.leaving(room);
    expect(play.mock.calls).toEqual([['join'], ['leave']]);
  });
});
