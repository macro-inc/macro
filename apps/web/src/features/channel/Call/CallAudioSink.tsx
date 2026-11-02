import { For, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { TrackView } from './TrackView';

const REMOTE_AUDIO_SOURCES = [
  LK_TRACK_SOURCE.Microphone,
  LK_TRACK_SOURCE.ScreenShareAudio,
] as const;

/**
 * Hidden, mount-persistent sink that plays remote participants' microphone
 * and screen-share audio. Must be mounted above the channel tab <Switch> so
 * that audio keeps playing when the user navigates away from the Call tab to
 * Messages / Attachments / Participants — those tab switches unmount
 * CallOverlay and would otherwise tear down every <audio> element.
 *
 * This is audio-only on purpose: video tiles / local preview / screen share /
 * controls stay scoped to CallOverlay since there's no value in running that
 * pipeline when the user isn't looking at it.
 */
export function CallAudioSink() {
  const callCtx = useCallContext();

  const remoteAudioTracks = () => {
    // Subscribe to trackVersion so audio subscribe / unsubscribe / replace
    // events propagate (same reactivity pattern as ParticipantTile). <For>
    // keys by the Track itself, so one share starting or stopping leaves the
    // other audio elements mounted.
    callCtx.trackVersion();
    return Array.from(callCtx.remoteParticipants().values())
      .filter((p) => !p.isAgent)
      .flatMap((p) =>
        REMOTE_AUDIO_SOURCES.flatMap((source) => {
          const track = p.getTrackPublication(source)?.track;
          return track ? [track] : [];
        })
      );
  };

  return (
    <Show when={callCtx.isInCall()}>
      <div
        class="absolute size-0 overflow-hidden pointer-events-none"
        aria-hidden="true"
      >
        <For each={remoteAudioTracks()}>
          {(track) => <TrackView track={track} />}
        </For>
      </div>
    </Show>
  );
}
