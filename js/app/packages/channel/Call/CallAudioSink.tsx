import { Track } from 'livekit-client';
import { For, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { TrackView } from './TrackView';

/**
 * Hidden, mount-persistent sink that plays remote participants' microphone
 * audio. Must be mounted above the channel tab <Switch> so that audio keeps
 * playing when the user navigates away from the Call tab to Messages /
 * Attachments / Participants — those tab switches unmount CallOverlay and
 * would otherwise tear down every <audio> element.
 *
 * This is audio-only on purpose: video tiles / local preview / screen share /
 * controls stay scoped to CallOverlay since there's no value in running that
 * pipeline when the user isn't looking at it.
 */
export function CallAudioSink() {
  const callCtx = useCallContext();

  const remoteMicTracks = () => {
    // Subscribe to trackVersion so mic subscribe / unsubscribe / replace events
    // propagate (same reactivity pattern as ParticipantTile).
    callCtx.trackVersion();
    return Array.from(callCtx.remoteParticipants().values())
      .filter((p) => !p.isAgent)
      .map((p) => ({
        id: p.identity,
        track: p.getTrackPublication(Track.Source.Microphone)?.track,
      }));
  };

  return (
    <Show when={callCtx.isInCall()}>
      <div
        class="absolute size-0 overflow-hidden pointer-events-none"
        aria-hidden="true"
      >
        <For each={remoteMicTracks()}>
          {(entry) => <TrackView track={entry.track} />}
        </For>
      </div>
    </Show>
  );
}
