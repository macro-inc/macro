import { Room, RoomEvent, Track } from 'livekit-client';
import {
  type CallTarget,
  callIdForRoom,
  connectRoomWith,
  type JoinOptions,
} from './common';
import { reportError, withSpan } from './telemetry';

export type { CallConnection, CallTarget, JoinOptions } from './common';

export type ScreenShare = {
  stop(): Promise<void>;
  stopped: Promise<void>;
};

export type ScreenOptions = DisplayMediaStreamOptions;

export function connectRoom(target: CallTarget, options?: JoinOptions) {
  const room = new Room({ publishDefaults: { dtx: false } });
  return connectRoomWith(
    target,
    options,
    room,
    (room, connection) => room.connect(connection.url, connection.token),
    (room, callback) => room.on(RoomEvent.Disconnected, callback),
  );
}

/** Publish a MediaStream, or open the browser's screen picker. */
export async function publishScreen(
  room: Room,
  source?: MediaStream,
  options: ScreenOptions = {},
): Promise<ScreenShare> {
  return withSpan('call.sdk.publish_screen', async (span) => {
    const callId = callIdForRoom(room);
    if (callId) span.setAttribute('call.id', callId);
    span.setAttribute('call.sdk.source_kind', source ? 'stream' : 'picker');
    const owned = !source;
    const stream = source ?? await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      ...options,
    });
    const video = stream.getVideoTracks()[0];
    if (!video) {
      if (owned) stream.getTracks().forEach((track) => track.stop());
      throw new Error('Screen stream has no video track');
    }
    const audio = stream.getAudioTracks()[0];
    const settings = video.getSettings();
    if (settings.width) span.setAttribute('call.sdk.width', settings.width);
    if (settings.height) span.setAttribute('call.sdk.height', settings.height);
    if (settings.frameRate) span.setAttribute('call.sdk.fps', settings.frameRate);

    let stopping: Promise<void> | undefined;
    let resolveStopped: () => void = () => {};
    const stoppedPromise = new Promise<void>((resolve) => { resolveStopped = resolve; });
    const published: MediaStreamTrack[] = [];
    const stop = () => stopping ??= (async () => {
      try {
        for (const track of published) {
          await room.localParticipant.unpublishTrack(track, false);
        }
      } finally {
        if (owned) stream.getTracks().forEach((track) => track.stop());
        resolveStopped();
      }
    })();
    video.addEventListener('ended', () => {
      stop().catch((error: unknown) => reportError('call.sdk.publish_screen', error, callId));
    }, { once: true });
    room.on(RoomEvent.Disconnected, () => {
      stop().catch((error: unknown) => reportError('call.sdk.publish_screen', error, callId));
    });

    try {
      await room.localParticipant.publishTrack(video, {
        source: Track.Source.ScreenShare,
      });
      published.push(video);
      if (audio) {
        await room.localParticipant.publishTrack(audio, {
          source: Track.Source.ScreenShareAudio,
          dtx: false,
        });
        published.push(audio);
      }
      span.setAttribute('call.sdk.outcome', 'published');
    } catch (error) {
      await stop();
      throw error;
    }

    return { stop, stopped: stoppedPromise };
  });
}
