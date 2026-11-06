import { Telemetry } from '@macro-inc/observability';
import {
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoFrame,
  VideoSource,
} from '@livekit/rtc-node';
import {
  type CallTarget,
  callIdForRoom,
  connectRoomWith,
  type JoinOptions,
} from './common';

export type { CallConnection, CallTarget, JoinOptions } from './common';

export type ScreenFrame = {
  data: Uint8Array;
  width: number;
  height: number;
  format: 'I420' | 'RGBA';
};

export type ScreenShare = {
  stop(): Promise<void>;
  stopped: Promise<void>;
};

export type ScreenOptions = {
  fps?: number;
  maxBitrate?: number;
  name?: string;
};

export function connectRoom(target: CallTarget, options?: JoinOptions) {
  const room = new Room();
  return connectRoomWith(
    target,
    options,
    room,
    async (room, connection) => {
      await room.connect(connection.url, connection.token, {
        autoSubscribe: true,
        dynacast: false,
      });
      const participant = room.localParticipant;
      if (!participant) throw new Error('Room connected without a local participant');

      // rtc-node has no room-wide publish defaults. Apply the app's DTX
      // setting to audio tracks published by the caller after connection.
      const publish = participant.publishTrack.bind(participant);
      participant.publishTrack = (track, publishOptions) => {
        if (track.kind === TrackKind.KIND_AUDIO) publishOptions.dtx = false;
        return publish(track, publishOptions);
      };
    },
    (room, callback) => room.on(RoomEvent.Disconnected, callback),
  );
}

/** Publish caller-supplied I420 or RGBA frames as a screen share. */
export async function publishScreen(
  room: Room,
  frames: AsyncIterable<ScreenFrame>,
  options: ScreenOptions = {},
): Promise<ScreenShare> {
  return Telemetry.span('call.sdk.publish_screen', async (span) => {
    const callId = callIdForRoom(room);
    if (callId) span.setAttr('call.id', callId);
    span.setAttr('call.sdk.source_kind', 'frames');
    const iterator = frames[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error('Screen source produced no frames');

    const { width, height } = first.value;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Screen frames require positive integer dimensions');
    }
    span.setAttr('call.sdk.width', width);
    span.setAttr('call.sdk.height', height);
    span.setAttr('call.sdk.fps', options.fps ?? 15);

    const source = new VideoSource(width, height);
    const track = LocalVideoTrack.createVideoTrack(options.name ?? 'screen', source);
    const publishOptions = new TrackPublishOptions({
      source: TrackSource.SOURCE_SCREENSHARE,
      simulcast: false,
      videoEncoding: {
        maxBitrate: BigInt(options.maxBitrate ?? 2_500_000),
        maxFramerate: options.fps ?? 15,
      },
    });

    let stopped = false;
    let resolveStopped: () => void = () => {};
    const stoppedPromise = new Promise<void>((resolve) => { resolveStopped = resolve; });
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      try {
        await iterator.return?.();
        if (track.sid) await room.localParticipant?.unpublishTrack(track.sid, false);
      } finally {
        try {
          await track.close();
        } finally {
          resolveStopped();
        }
      }
    };

    try {
      const participant = room.localParticipant;
      if (!participant) throw new Error('Room is not connected');
      await participant.publishTrack(track, publishOptions);
      span.setAttr('call.sdk.outcome', 'published');
    } catch (error) {
      span.error(error);
      await stop();
      throw error;
    }

    const pump = async () => {
      try {
        let frame: IteratorResult<ScreenFrame> = first;
        while (!stopped && !frame.done) {
          const value = frame.value;
          if (value.width !== width || value.height !== height) {
            throw new Error('Screen frame dimensions changed');
          }
          source.captureFrame(new VideoFrame(
            value.data,
            width,
            height,
            value.format === 'I420' ? VideoBufferType.I420 : VideoBufferType.RGBA,
          ));
          frame = await iterator.next();
        }
      } finally {
        await stop();
      }
    };
    void pump().catch((error: unknown) => span.error(error));
    room.on(RoomEvent.Disconnected, () => { void stop(); });

    return { stop, stopped: stoppedPromise };
  });
}
