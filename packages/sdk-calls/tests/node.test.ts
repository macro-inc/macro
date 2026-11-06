import { describe, expect, mock, test } from 'bun:test';

const published: Array<{
  kind: number;
  options: {
    dtx?: boolean;
    source?: number;
    videoEncoding?: { maxBitrate?: bigint };
  };
}> = [];
const captured: Array<{ width: number; height: number; type: number }> = [];
const unpublished: string[] = [];

mock.module('@livekit/rtc-node', () => ({
  TrackKind: { KIND_AUDIO: 1 },
  TrackSource: { SOURCE_SCREENSHARE: 3 },
  VideoBufferType: { RGBA: 0, I420: 5 },
  RoomEvent: { Disconnected: 'disconnected' },
  TrackPublishOptions: class {
    source?: number;
    videoEncoding?: { maxBitrate?: bigint };
    constructor(data: object = {}) {
      Object.assign(this, data);
    }
  },
  VideoFrame: class {
    constructor(
      _data: Uint8Array,
      public width: number,
      public height: number,
      public type: number
    ) {}
  },
  VideoSource: class {
    captureFrame(frame: { width: number; height: number; type: number }) {
      captured.push(frame);
    }
    async close() {}
  },
  LocalVideoTrack: {
    createVideoTrack: () => ({
      kind: 2,
      sid: 'track-1',
      close: async () => {},
    }),
  },
  Room: class {
    localParticipant = {
      publishTrack: async (
        track: { kind: number },
        options: { dtx?: boolean; source?: number }
      ) => {
        published.push({ kind: track.kind, options });
        return { sid: 'publication-1' };
      },
      unpublishTrack: async (sid: string) => {
        unpublished.push(sid);
      },
    };
    on(_event: string, _callback: () => void) {}
    async connect() {}
  },
}));

const { connectRoom, publishScreen } = await import('../src/node');

describe('Node room helpers', () => {
  test('disables DTX for published audio', async () => {
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
    await Reflect.apply(
      room.localParticipant!.publishTrack,
      room.localParticipant,
      [{ kind: 1 }, { dtx: true }]
    );
    expect(published.at(-1)?.options.dtx).toBe(false);
  });

  test('publishes RGBA frames with a screen source and encoding', async () => {
    async function* frames() {
      yield {
        data: new Uint8Array(16),
        width: 2,
        height: 2,
        format: 'RGBA' as const,
      };
    }
    const connection = {
      call: { id: 'call-2' },
      url: 'wss://example.invalid',
      token: 'secret',
      identity: 'account-2',
      roomName: 'room-2',
      started: false,
      leave: async () => ({ callEnded: false }),
    };
    const { room } = await connectRoom({ join: async () => connection });
    const share = await publishScreen(room, frames());
    await share.stopped;
    expect(published.at(-1)?.options.source).toBe(3);
    expect(published.at(-1)?.options.videoEncoding?.maxBitrate).toBe(
      2_500_000n
    );
    expect(captured.at(-1)).toMatchObject({ width: 2, height: 2, type: 0 });
    expect(unpublished.at(-1)).toBe('publication-1');
  });
});
