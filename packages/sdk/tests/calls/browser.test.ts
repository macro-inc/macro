import { describe, expect, mock, test } from 'bun:test';

const published: Array<{
  track: MediaStreamTrack;
  options: { source: string; dtx?: boolean };
}> = [];
const unpublished: MediaStreamTrack[] = [];

mock.module('livekit-client', () => ({
  RoomEvent: { Disconnected: 'disconnected' },
  Track: {
    Source: {
      ScreenShare: 'screen_share',
      ScreenShareAudio: 'screen_share_audio',
    },
  },
  Room: class {
    localParticipant = {
      publishTrack: async (
        track: MediaStreamTrack,
        options: { source: string; dtx?: boolean },
      ) => {
        published.push({ track, options });
      },
      unpublishTrack: async (track: MediaStreamTrack) => {
        unpublished.push(track);
      },
    };
    on(_event: string, _callback: () => void) {}
    async connect() {}
  },
}));

const { connectRoom, publishScreen } = await import('../../src/calls/browser');

describe('browser screen share', () => {
  test('publishes video and audio with screen sources and stops both', async () => {
    const video = {
      getSettings: () => ({ width: 1280, height: 720 }),
      addEventListener: () => {},
      stop: () => {},
    };
    const audio = { stop: () => {} };
    const stream = {
      getVideoTracks: () => [video],
      getAudioTracks: () => [audio],
      getTracks: () => [video, audio],
    };
    const connection = {
      call: { id: 'call-1' },
      url: 'wss://example.invalid',
      token: 'secret',
      identity: 'account-1',
      roomName: 'room-1',
      started: false,
      leave: async () => ({ callEnded: false }),
    };
    const { room } = await connectRoom({ join: async () => connection });
    const share = await Reflect.apply(publishScreen, undefined, [room, stream]);
    await share.stop();

    expect(published.map(({ options }) => options.source)).toEqual([
      'screen_share',
      'screen_share_audio',
    ]);
    expect(published[1]?.options.dtx).toBe(false);
    expect(unpublished).toHaveLength(2);
  });
});
