import {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  Track,
} from 'livekit-client';
import { describe, expect, it } from 'vitest';
import {
  getLivekit,
  LK_CONNECTION_STATE,
  LK_DISCONNECT_REASON,
  LK_ROOM_EVENT,
  LK_TRACK_SOURCE,
  loadLivekit,
} from '../livekit-loader';

describe('livekit-loader', () => {
  it('keeps enum mirrors aligned with the runtime SDK', () => {
    expect(LK_CONNECTION_STATE).toEqual({
      Disconnected: ConnectionState.Disconnected,
      Connecting: ConnectionState.Connecting,
      Connected: ConnectionState.Connected,
      Reconnecting: ConnectionState.Reconnecting,
      SignalReconnecting: ConnectionState.SignalReconnecting,
    });
    expect(LK_TRACK_SOURCE).toEqual({
      Camera: Track.Source.Camera,
      Microphone: Track.Source.Microphone,
      ScreenShare: Track.Source.ScreenShare,
    });
    expect(LK_ROOM_EVENT.Disconnected).toBe(RoomEvent.Disconnected);
    expect(LK_DISCONNECT_REASON).toEqual({
      CLIENT_INITIATED: DisconnectReason.CLIENT_INITIATED,
      DUPLICATE_IDENTITY: DisconnectReason.DUPLICATE_IDENTITY,
      PARTICIPANT_REMOVED: DisconnectReason.PARTICIPANT_REMOVED,
      ROOM_DELETED: DisconnectReason.ROOM_DELETED,
      ROOM_CLOSED: DisconnectReason.ROOM_CLOSED,
    });
  });

  it('shares one in-flight LiveKit import and exposes the loaded module', async () => {
    const first = loadLivekit();
    const second = loadLivekit();

    expect(second).toBe(first);
    const module = await first;
    expect(getLivekit()).toBe(module);
  });
});
