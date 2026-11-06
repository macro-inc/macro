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
} from './common.js';
import { reportError, withSpan } from './telemetry.js';

export type { CallConnection, CallTarget, JoinOptions } from './common.js';

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
      if (!participant)
        throw new Error('Room connected without a local participant');

      // rtc-node has no room-wide publish defaults or publish hook. Wrapping
      // publishTrack is the only way to set DTX for caller-published audio.
      const publish = participant.publishTrack.bind(participant);
      participant.publishTrack = (track, publishOptions) => {
        if (track.kind === TrackKind.KIND_AUDIO) publishOptions.dtx = false;
        return publish(track, publishOptions);
      };
    },
    (room, callback) => room.on(RoomEvent.Disconnected, callback)
  );
}

/** Publish caller-supplied I420 or RGBA frames as a screen share. */
export async function publishScreen(
  room: Room,
  frames: AsyncIterable<ScreenFrame>,
  options: ScreenOptions = {}
): Promise<ScreenShare> {
  return withSpan('call.sdk.publish_screen', async (span) => {
    const callId = callIdForRoom(room);
    if (callId) span.setAttribute('call.id', callId);
    span.setAttribute('call.sdk.source_kind', 'frames');
    const iterator = frames[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error('Screen source produced no frames');

    const { width, height } = first.value;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1
    ) {
      throw new Error('Screen frames require positive integer dimensions');
    }
    span.setAttribute('call.sdk.width', width);
    span.setAttribute('call.sdk.height', height);
    span.setAttribute('call.sdk.fps', options.fps ?? 15);

    const source = new VideoSource(width, height);
    const track = LocalVideoTrack.createVideoTrack(
      options.name ?? 'screen',
      source
    );
    const publishOptions = new TrackPublishOptions({
      source: TrackSource.SOURCE_SCREENSHARE,
      simulcast: false,
      videoEncoding: {
        maxBitrate: BigInt(options.maxBitrate ?? 2_500_000),
        maxFramerate: options.fps ?? 15,
      },
    });

    let stopped = false;
    let stopping: Promise<void> | undefined;
    let publicationSid: string | undefined;
    let resolveStopped: () => void = () => {};
    const stoppedPromise = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const stop = () =>
      (stopping ??= (async () => {
        stopped = true;
        try {
          await iterator.return?.();
        } finally {
          try {
            if (publicationSid)
              await room.localParticipant?.unpublishTrack(
                publicationSid,
                false
              );
          } finally {
            try {
              await track.close();
            } finally {
              resolveStopped();
            }
          }
        }
      })());

    try {
      const participant = room.localParticipant;
      if (!participant) throw new Error('Room is not connected');
      const publication = await participant.publishTrack(track, publishOptions);
      publicationSid = publication.sid;
      span.setAttribute('call.sdk.outcome', 'published');
    } catch (error) {
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
          source.captureFrame(
            new VideoFrame(
              value.data,
              width,
              height,
              value.format === 'I420'
                ? VideoBufferType.I420
                : VideoBufferType.RGBA
            )
          );
          frame = await iterator.next();
        }
      } finally {
        await stop();
      }
    };
    pump().catch((error: unknown) =>
      reportError('call.sdk.publish_screen', error, callId)
    );
    room.on(RoomEvent.Disconnected, () => {
      stop().catch((error: unknown) =>
        reportError('call.sdk.publish_screen', error, callId)
      );
    });

    return { stop, stopped: stoppedPromise };
  });
}
