import { Track, type RemoteParticipant } from 'livekit-client';
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  on,
  type Component,
  type JSX,
} from 'solid-js';
import PhoneDisconnect from '@icon/regular/phone-disconnect.svg';
import Microphone from '@icon/regular/microphone.svg';
import MicrophoneSlash from '@icon/regular/microphone-slash.svg';
import VideoCamera from '@icon/regular/video-camera.svg';
import VideoCameraSlash from '@icon/regular/video-camera-slash.svg';
import Screencast from '@icon/regular/screencast.svg';
import { useCallContext } from './CallContext';

/**
 * Generic track view that attaches/detaches a LiveKit track's media element.
 * Callers resolve the track; this component handles the DOM lifecycle.
 */
function TrackView(props: {
  track: Track | undefined;
  fit?: 'cover' | 'contain';
  mirror?: boolean;
}) {
  let ref!: HTMLDivElement;
  let attachedTrack: Track | undefined;
  let attachedElement: Element | undefined;

  createEffect(
    on(
      () => props.track,
      (track, prev) => {
        if (prev === track) return;

        prev?.detach().forEach((el) => el.remove());
        attachedTrack = undefined;
        attachedElement = undefined;

        if (!track) return;

        const el = track.attach();
        attachedTrack = track;
        attachedElement = el;
        Object.assign(el.style, {
          width: '100%',
          height: '100%',
          objectFit: props.fit ?? 'cover',
          transform: props.mirror ? 'scaleX(-1)' : '',
        });
        ref.appendChild(el);
      }
    )
  );

  onCleanup(() => {
    if (attachedTrack) {
      attachedTrack.detach().forEach((el) => el.remove());
    } else {
      attachedElement?.remove();
    }
  });

  return <div ref={ref} class="w-full h-full" />;
}

function ParticipantTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();

  const micTrack = () => {
    callCtx.trackVersion();
    return props.participant.getTrackPublication(Track.Source.Microphone)
      ?.track;
  };

  const cameraTrack = () => {
    callCtx.trackVersion();
    const pub = props.participant.getTrackPublication(Track.Source.Camera);
    return pub?.isSubscribed && !pub.isMuted ? pub.track : undefined;
  };

  const isSpeaking = () => callCtx.isParticipantSpeaking(props.participant);

  return (
    <div
      class="relative flex items-center justify-center rounded-lg overflow-hidden bg-surface-2 min-h-[120px]"
      classList={{ 'ring-2 ring-accent-2': isSpeaking() }}
    >
      {/* Attach remote audio so we can hear this participant (visually hidden to avoid stealing layout) */}
      <div class="absolute w-0 h-0 overflow-hidden">
        <TrackView track={micTrack()} />
      </div>
      <Show
        when={cameraTrack()}
        fallback={
          <div class="flex items-center justify-center w-full h-full p-4">
            <div class="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center text-ink-muted text-lg font-medium">
              {props.participant.identity.charAt(0).toUpperCase()}
            </div>
          </div>
        }
      >
        <TrackView track={cameraTrack()} />
      </Show>
      <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface-0/70 text-ink text-xs truncate max-w-[80%]">
        {props.participant.identity}
      </div>
    </div>
  );
}

const ControlButton: Component<{
  onClick: () => Promise<void> | void;
  active?: boolean;
  danger?: boolean;
  children?: JSX.Element;
}> = (props) => {
  const [isPending, setIsPending] = createSignal(false);

  const handleClick = async () => {
    if (isPending()) return;
    setIsPending(true);
    try {
      await props.onClick();
    } catch (e) {
      console.error('ControlButton action failed', e);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isPending()}
      class="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
      classList={{
        'opacity-50 cursor-not-allowed': isPending(),
        'bg-failure text-panel hover:bg-failure/80':
          props.danger && !isPending(),
        'bg-surface-2 text-ink hover:bg-surface-3':
          !props.danger && !props.active && !isPending(),
        'bg-accent-2 text-panel hover:bg-accent-3':
          !props.danger && props.active && !isPending(),
      }}
    >
      {props.children}
    </button>
  );
};

function ScreenShareTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();
  const screenTrack = () => {
    callCtx.trackVersion();
    return props.participant.getTrackPublication(Track.Source.ScreenShare)
      ?.track;
  };

  return (
    <div class="relative flex items-center justify-center rounded-lg overflow-hidden bg-surface-2">
      <TrackView track={screenTrack()} fit="contain" />
      <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface-0/70 text-ink text-xs truncate max-w-[80%]">
        {props.participant.identity}'s screen
      </div>
    </div>
  );
}

export function CallOverlay(props: { onLeave: () => void }) {
  const callCtx = useCallContext();

  const participants = () =>
    Array.from(callCtx.remoteParticipants().values()).filter((p) => !p.isAgent);

  const isLocalSpeaking = () => callCtx.isLocalSpeaking();

  const localVideoTrack = () => {
    callCtx.trackVersion();
    const r = callCtx.room();
    if (!r || callCtx.isVideoMuted()) return undefined;
    return r.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
  };

  const localScreenTrack = () => {
    callCtx.trackVersion();
    const r = callCtx.room();
    if (!r || !callCtx.isScreenSharing()) return undefined;
    return r.localParticipant.getTrackPublication(Track.Source.ScreenShare)
      ?.track;
  };

  const remoteScreenShares = () => {
    callCtx.trackVersion();
    return participants().filter((p) => {
      const pub = p.getTrackPublication(Track.Source.ScreenShare);
      return pub?.isSubscribed && !pub.isMuted;
    });
  };

  const hasAnyScreenShare = () =>
    callCtx.isScreenSharing() || remoteScreenShares().length > 0;

  const gridCols = () => {
    const count = participants().length + 1; // +1 for local
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <div class="flex flex-col h-full bg-surface-0">
      {/* Screen share area */}
      <Show when={hasAnyScreenShare()}>
        <div class="flex-1 min-h-0 p-2">
          <div class="h-full rounded-lg overflow-hidden bg-surface-2 flex items-center justify-center">
            <Show when={callCtx.isScreenSharing()}>
              <div class="relative w-full h-full">
                <TrackView track={localScreenTrack()} fit="contain" />
                <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface-0/70 text-ink text-xs">
                  Your screen
                </div>
              </div>
            </Show>
            <For each={remoteScreenShares()}>
              {(participant) => <ScreenShareTile participant={participant} />}
            </For>
          </div>
        </div>
      </Show>

      {/* Participants grid */}
      <div
        class={`${hasAnyScreenShare() ? 'h-[140px] shrink-0' : 'flex-1 min-h-0'} grid ${gridCols()} gap-2 p-2 auto-rows-fr overflow-hidden`}
      >
        {/* Local participant */}
        <div
          class="relative flex items-center justify-center rounded-lg overflow-hidden bg-surface-2 min-h-[120px]"
          classList={{
            'ring-2 ring-accent-2': isLocalSpeaking(),
          }}
        >
          <Show
            when={!callCtx.isVideoMuted()}
            fallback={
              <div class="flex items-center justify-center w-full h-full p-4">
                <div class="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center text-ink-muted text-lg font-medium">
                  You
                </div>
              </div>
            }
          >
            <TrackView track={localVideoTrack()} mirror />
          </Show>
          <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface-0/70 text-ink text-xs">
            You
          </div>
        </div>

        <For each={participants()}>
          {(participant) => <ParticipantTile participant={participant} />}
        </For>
      </div>

      {/* Controls bar */}
      <div class="flex items-center justify-center gap-3 p-3 bg-surface-1 border-t border-edge">
        <ControlButton
          onClick={() => callCtx.toggleAudio()}
          active={!callCtx.isAudioMuted()}
        >
          <Show
            when={!callCtx.isAudioMuted()}
            fallback={<MicrophoneSlash class="w-5 h-5" />}
          >
            <Microphone class="w-5 h-5" />
          </Show>
        </ControlButton>

        <ControlButton
          onClick={() => callCtx.toggleVideo()}
          active={!callCtx.isVideoMuted()}
        >
          <Show
            when={!callCtx.isVideoMuted()}
            fallback={<VideoCameraSlash class="w-5 h-5" />}
          >
            <VideoCamera class="w-5 h-5" />
          </Show>
        </ControlButton>

        <ControlButton
          onClick={() => callCtx.toggleScreenShare()}
          active={callCtx.isScreenSharing()}
        >
          <Screencast class="w-5 h-5" />
        </ControlButton>

        <ControlButton onClick={props.onLeave} danger>
          <PhoneDisconnect class="w-5 h-5" />
        </ControlButton>
      </div>
    </div>
  );
}
