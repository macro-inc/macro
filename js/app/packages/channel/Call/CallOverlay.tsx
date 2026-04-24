import { Track, type RemoteParticipant } from 'livekit-client';
import { For, Show, createSignal, type Component, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { TrackView } from './TrackView';
import PhoneDisconnect from '@macro-icons/wide/call-disconnect.svg';
import Microphone from '@macro-icons/wide/microphone.svg';
import MicrophoneSlash from '@macro-icons/wide/microphone-slash.svg';
import VideoCamera from '@macro-icons/wide/video.svg';
import VideoCameraSlash from '@macro-icons/wide/video-slash.svg';
import Screencast from '@macro-icons/wide/screencast.svg';
import Users from '@macro-icons/wide/users.svg';
import CaretDown from '@icon/regular/caret-down.svg';
import { useToggleShareWithTeamMutation } from '@queries/call/call';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import {
  DropdownMenuContent,
  MenuItem,
  MenuGroup,
  GroupLabel,
  MenuSeparator,
} from '@core/component/Menu';
import { tryMacroId, useDisplayName } from '@core/user';
import { useCallContext, type MediaDeviceInfo } from './CallContext';

// Mirrors @livekit/track-processors' supportsBackgroundProcessors() =
// BackgroundProcessor.isSupported && ProcessorWrapper.isSupported. Kept local so the
// toggle renders without statically importing the WASM/MediaPipe-bearing package.
function isBackgroundBlurSupported(): boolean {
  if (typeof window === 'undefined') return false;
  // BackgroundProcessor.isSupported: OffscreenCanvas, VideoFrame, createImageBitmap, WebGL2.
  if (
    !('OffscreenCanvas' in window) ||
    !('VideoFrame' in window) ||
    !('createImageBitmap' in window)
  ) {
    return false;
  }
  try {
    if (!document.createElement('canvas').getContext('webgl2')) return false;
  } catch {
    return false;
  }
  // ProcessorWrapper.isSupported: modern MediaStreamTrackProcessor API OR canvas
  // captureStream() fallback (Firefox 126+).
  const hasStreamProcessor =
    'MediaStreamTrackProcessor' in window &&
    'MediaStreamTrackGenerator' in window;
  const hasFallback =
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype;
  return hasStreamProcessor || hasFallback;
}

function ParticipantTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const [displayName] = useDisplayName(macroId());

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
      {/* Remote mic audio is attached by <CallAudioSink /> so playback survives tab switches. */}
      <Show
        when={cameraTrack()}
        fallback={
          <div class="flex items-center justify-center w-full h-full p-4">
            <div class="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center text-ink-muted text-lg font-medium">
              {displayName().charAt(0).toUpperCase()}
            </div>
          </div>
        }
      >
        <TrackView track={cameraTrack()} />
      </Show>
      <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface-0/70 text-ink text-xs truncate max-w-[80%]">
        {displayName()}
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

/**
 * A call control button with a small dropdown chevron for device selection.
 * Similar to Google Meet's mic/camera buttons with a dropdown arrow.
 */
function ControlButtonWithDropdown(props: {
  onClick: () => Promise<void> | void;
  active?: boolean;
  children?: JSX.Element;
  dropdownContent: JSX.Element;
}) {
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
    <div class="relative flex items-center">
      <button
        onClick={handleClick}
        disabled={isPending()}
        class="w-10 h-10 rounded-l-full flex items-center justify-center transition-colors"
        classList={{
          'opacity-50 cursor-not-allowed': isPending(),
          'bg-surface-2 text-ink hover:bg-surface-3':
            !props.active && !isPending(),
          'bg-accent-2 text-panel hover:bg-accent-3':
            props.active && !isPending(),
        }}
      >
        {props.children}
      </button>
      <DropdownMenu>
        <DropdownMenu.Trigger
          class="h-10 w-5 rounded-r-full flex items-center justify-center transition-colors border-l"
          classList={{
            'bg-surface-2 text-ink hover:bg-surface-3 border-surface-3':
              !props.active,
            'bg-accent-2 text-panel hover:bg-accent-3 border-accent-3':
              props.active,
          }}
        >
          <CaretDown class="w-3 h-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenuContent class="mb-2" width="lg">
            {props.dropdownContent}
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
}

function DeviceList(props: {
  label: string;
  devices: MediaDeviceInfo[];
  activeDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <MenuGroup>
      <GroupLabel>{props.label}</GroupLabel>
      <DropdownMenu.RadioGroup
        value={props.activeDeviceId ?? ''}
        onChange={(value) => props.onSelect(value)}
      >
        <For each={props.devices}>
          {(device) => (
            <MenuItem
              text={device.label}
              selectorType="radio"
              value={device.deviceId}
              groupValue={props.activeDeviceId ?? ''}
            />
          )}
        </For>
      </DropdownMenu.RadioGroup>
    </MenuGroup>
  );
}

function ScreenShareTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const [displayName] = useDisplayName(macroId());
  const screenTrack = () => {
    callCtx.trackVersion();
    return props.participant.getTrackPublication(Track.Source.ScreenShare)
      ?.track;
  };

  return (
    <div class="relative flex items-center justify-center rounded-lg overflow-hidden bg-surface-2">
      <TrackView track={screenTrack()} fit="contain" />
      <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface-0/70 text-ink text-xs truncate max-w-[80%]">
        {displayName()}'s screen
      </div>
    </div>
  );
}

export function CallOverlay(props: { onLeave: () => void }) {
  const callCtx = useCallContext();
  const toggleShareWithTeam = useToggleShareWithTeamMutation();

  const handleToggleShareWithTeam = async () => {
    const callId = callCtx.activeCallId();
    if (!callId) return;
    const newValue = await toggleShareWithTeam.mutateAsync(callId);
    callCtx.setSharedWithTeam(newValue);
  };

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
        class={cn(
          'grid gap-2 p-2 auto-rows-fr overflow-hidden',
          hasAnyScreenShare() ? 'h-[140px] shrink-0' : 'flex-1 min-h-0',
          gridCols()
        )}
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
        <ControlButtonWithDropdown
          onClick={() => callCtx.toggleAudio()}
          active={!callCtx.isAudioMuted()}
          dropdownContent={
            <>
              <DeviceList
                label="Microphone"
                devices={callCtx.audioInputDevices()}
                activeDeviceId={callCtx.activeAudioInputDeviceId()}
                onSelect={(id) => callCtx.switchAudioInput(id)}
              />
              <Show when={callCtx.audioOutputDevices().length > 0}>
                <MenuSeparator />
                <DeviceList
                  label="Speaker"
                  devices={callCtx.audioOutputDevices()}
                  activeDeviceId={callCtx.activeAudioOutputDeviceId()}
                  onSelect={(id) => callCtx.switchAudioOutput(id)}
                />
              </Show>
              <MenuSeparator />
              <MenuGroup>
                <GroupLabel>Effects</GroupLabel>
                <MenuItem
                  text="Noise suppression"
                  selectorType="checkbox"
                  checked={callCtx.isNoiseSuppressed()}
                  closeOnSelect={false}
                  onClick={() => callCtx.toggleNoiseSuppression()}
                />
              </MenuGroup>
            </>
          }
        >
          <Show
            when={!callCtx.isAudioMuted()}
            fallback={<MicrophoneSlash class="w-5 h-5" />}
          >
            <Microphone class="w-5 h-5" />
          </Show>
        </ControlButtonWithDropdown>

        <ControlButtonWithDropdown
          onClick={() => callCtx.toggleVideo()}
          active={!callCtx.isVideoMuted()}
          dropdownContent={
            <>
              <DeviceList
                label="Camera"
                devices={callCtx.videoInputDevices()}
                activeDeviceId={callCtx.activeVideoInputDeviceId()}
                onSelect={(id) => callCtx.switchVideoInput(id)}
              />
              <Show when={isBackgroundBlurSupported()}>
                <MenuSeparator />
                <MenuGroup>
                  <GroupLabel>Effects</GroupLabel>
                  <MenuItem
                    text="Blur background"
                    selectorType="checkbox"
                    checked={callCtx.isBackgroundBlurred()}
                    closeOnSelect={false}
                    onClick={() => callCtx.toggleBackgroundBlur()}
                  />
                </MenuGroup>
              </Show>
            </>
          }
        >
          <Show
            when={!callCtx.isVideoMuted()}
            fallback={<VideoCameraSlash class="w-5 h-5" />}
          >
            <VideoCamera class="w-5 h-5" />
          </Show>
        </ControlButtonWithDropdown>

        <ControlButton
          onClick={() => callCtx.toggleScreenShare()}
          active={callCtx.isScreenSharing()}
        >
          <Screencast class="w-5 h-5" />
        </ControlButton>

        <div
          title={
            callCtx.isSharedWithTeam()
              ? 'Shared with team — click to make private'
              : 'Not shared — click to share with team'
          }
        >
          <ControlButton
            onClick={handleToggleShareWithTeam}
            active={callCtx.isSharedWithTeam()}
          >
            <Users class="w-5 h-5" />
          </ControlButton>
        </div>

        <ControlButton onClick={props.onLeave} danger>
          <PhoneDisconnect class="w-5 h-5" />
        </ControlButton>
      </div>
    </div>
  );
}
