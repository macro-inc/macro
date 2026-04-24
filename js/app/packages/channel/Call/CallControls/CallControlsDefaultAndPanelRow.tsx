import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import Microphone from '@icon/regular/microphone.svg';
import MicrophoneSlash from '@icon/regular/microphone-slash.svg';
import Screencast from '@icon/regular/screencast.svg';
import PhoneDisconnect from '@macro-icons/wide/call-disconnect.svg';
import VideoCamera from '@icon/regular/video-camera.svg';
import VideoCameraSlash from '@icon/regular/video-camera-slash.svg';
import Users from '@icon/regular/users.svg';
import { useToggleShareWithTeamMutation } from '@queries/call/call';
import { Show, type Accessor } from 'solid-js';
import { cn } from '@ui/utils/classname';
import {
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import type { CallControlVariant } from './CallControlButton';
import { CallControlButton } from './CallControlButton';
import { CallControlButtonWithDropdown } from './CallControlButtonWithDropdown';
import { menuGroupLabelClass, menuItemClass } from './call-controls-menu-styles';
import { CallDeviceList } from '../CallDeviceList';
import { useCallContext } from '../CallContext';

export type CallControlsDefaultAndPanelRowProps = {
  variant: Accessor<CallControlVariant>;
  class?: string;
  onLeave: () => void | Promise<void>;
};

// Mirrors @livekit/track-processors' supportsBackgroundProcessors()
// so this menu can render without statically importing heavy processor bundles.
function isBackgroundBlurSupported(): boolean {
  if (typeof window === 'undefined') return false;
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
  const hasStreamProcessor =
    'MediaStreamTrackProcessor' in window &&
    'MediaStreamTrackGenerator' in window;
  const hasFallback =
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype;
  return hasStreamProcessor || hasFallback;
}

export function CallControlsDefaultAndPanelRow(
  props: CallControlsDefaultAndPanelRowProps
) {
  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();
  const variant = () => props.variant();
  const iconClass = () => (variant() === 'panel' ? 'w-4 h-4' : 'w-5 h-5');
  const toggleShareWithTeam = useToggleShareWithTeamMutation();

  const handleToggleShareWithTeam = async () => {
    const callId = callCtx.activeCallId();
    if (!callId) return;
    const newValue = await toggleShareWithTeam.mutateAsync(callId);
    callCtx.setSharedWithTeam(newValue);
  };

  return (
    <div
      data-call-controls
      class={cn(
        'flex flex-row flex-wrap items-center',
        variant() === 'default' && 'justify-center gap-3',
        variant() === 'panel' &&
          'justify-around gap-0 divide-x divide-edge-muted [&>*]:px-1 [&>*:first-child]:pl-0',
        props.class
      )}
    >
      <CallControlButtonWithDropdown
        variant={variant()}
        onClick={() => callCtx.toggleAudio()}
        active={!callCtx.isAudioMuted()}
        disabled={isConnecting()}
        dropdownContent={() => (
          <>
            <CallDeviceList
              label="Microphone"
              devices={callCtx.audioInputDevices()}
              activeDeviceId={callCtx.activeAudioInputDeviceId()}
              onSelect={(id) => callCtx.switchAudioInput(id)}
            />
            <Show when={callCtx.audioOutputDevices().length > 0}>
              <MenuSeparator />
              <CallDeviceList
                label="Speaker"
                devices={callCtx.audioOutputDevices()}
                activeDeviceId={callCtx.activeAudioOutputDeviceId()}
                onSelect={(id) => callCtx.switchAudioOutput(id)}
              />
            </Show>
          </>
        )}
      >
        <Show
          when={!callCtx.isAudioMuted()}
          fallback={<MicrophoneSlash class={iconClass()} />}
        >
          <Microphone class={iconClass()} />
        </Show>
      </CallControlButtonWithDropdown>

      <CallControlButtonWithDropdown
        variant={variant()}
        onClick={() => callCtx.toggleVideo()}
        active={!callCtx.isVideoMuted()}
        disabled={isConnecting()}
        dropdownContent={() => (
          <>
            <CallDeviceList
              label="Camera"
              devices={callCtx.videoInputDevices()}
              activeDeviceId={callCtx.activeVideoInputDeviceId()}
              onSelect={(id) => callCtx.switchVideoInput(id)}
            />
            <Show when={isBackgroundBlurSupported()}>
              <MenuSeparator />
              <MenuGroup>
                <DropdownMenu.GroupLabel class={menuGroupLabelClass}>
                  Effects
                </DropdownMenu.GroupLabel>
                <MenuItem
                  class={menuItemClass}
                  text="Blur background"
                  selectorType="checkbox"
                  checked={callCtx.isBackgroundBlurred()}
                  closeOnSelect={false}
                  onClick={() => callCtx.toggleBackgroundBlur()}
                />
              </MenuGroup>
            </Show>
          </>
        )}
      >
        <Show
          when={!callCtx.isVideoMuted()}
          fallback={<VideoCameraSlash class={iconClass()} />}
        >
          <VideoCamera class={iconClass()} />
        </Show>
      </CallControlButtonWithDropdown>

      <CallControlButton
        variant={variant()}
        onClick={() => callCtx.toggleScreenShare()}
        active={callCtx.isScreenSharing()}
        disabled={isConnecting()}
      >
        <Screencast class={iconClass()} />
      </CallControlButton>

      <CallControlButton
        variant={variant()}
        onClick={handleToggleShareWithTeam}
        active={callCtx.isSharedWithTeam()}
        disabled={isConnecting()}
      >
        <Users class={iconClass()} />
      </CallControlButton>

      <CallControlButton
        variant={variant()}
        onClick={props.onLeave}
        disabled={isConnecting()}
        danger
      >
        <PhoneDisconnect class={iconClass()} />
      </CallControlButton>
    </div>
  );
}
