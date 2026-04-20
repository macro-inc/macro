import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Show, type Accessor } from 'solid-js';
import Microphone from '@icon/regular/microphone.svg';
import MicrophoneSlash from '@icon/regular/microphone-slash.svg';
import VideoCamera from '@icon/regular/video-camera.svg';
import VideoCameraSlash from '@icon/regular/video-camera-slash.svg';
import Screencast from '@icon/regular/screencast.svg';
import PhoneDisconnect from '@icon/regular/phone-disconnect.svg';
import { cn } from '@ui/utils/classname';
import type { CallControlVariant } from './CallControlButton';
import { CallControlButton } from './CallControlButton';
import { CallControlButtonWithDropdown } from './CallControlButtonWithDropdown';
import { CallDeviceList } from './CallDeviceList';
import { useCallContext } from './CallContext';

export type CallControlsProps = {
  /** Leave / hang up — parent supplies tab switch, `leaveCall()`, etc. */
  onLeave: () => void | Promise<void>;
  /**
   * `default`: bordered controls (overlay bar).
   * `panel`: flat layout; icon text uses same tokens as default (`ink`, `accent-2`, `failure`).
   */
  variant?: CallControlVariant;
  /**
   * When false, the control row is not rendered. Pass an accessor to react to
   * changing visibility. Omitted or true keeps controls visible.
   */
  when?: boolean | Accessor<boolean>;
  class?: string;
};

function readWhen(
  when: boolean | Accessor<boolean> | undefined
): boolean {
  if (when === undefined) return true;
  return typeof when === 'function' ? when() : when;
}

/**
 * Mic / camera / screen / leave wired to `useCallContext()`. Single place for
 * control markup so Call overlay and sidebar InCall panel stay in sync.
 */
export function CallControls(incoming: CallControlsProps) {
  const {
    onLeave,
    variant: variantProp,
    when: whenProp,
    class: className,
  } = incoming;

  const resolvedVariant = variantProp ?? 'default';
  const iconClass =
    resolvedVariant === 'panel' ? 'w-4 h-4' : 'w-5 h-5';

  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();

  return (
    <Show when={() => readWhen(whenProp)}>
      <div
        data-call-controls
        class={cn(
          'flex flex-row flex-wrap items-center',
          resolvedVariant === 'default' && 'justify-center gap-3',
          resolvedVariant === 'panel' &&
            'justify-start gap-0 divide-x divide-edge-muted [&>*]:px-1 [&>*:first-child]:pl-0',
          className
        )}
      >
        <CallControlButtonWithDropdown
          variant={resolvedVariant}
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
                <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />
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
            fallback={<MicrophoneSlash class={iconClass} />}
          >
            <Microphone class={iconClass} />
          </Show>
        </CallControlButtonWithDropdown>

        <CallControlButtonWithDropdown
          variant={resolvedVariant}
          onClick={() => callCtx.toggleVideo()}
          active={!callCtx.isVideoMuted()}
          disabled={isConnecting()}
          dropdownContent={() => (
            <CallDeviceList
              label="Camera"
              devices={callCtx.videoInputDevices()}
              activeDeviceId={callCtx.activeVideoInputDeviceId()}
              onSelect={(id) => callCtx.switchVideoInput(id)}
            />
          )}
        >
          <Show
            when={!callCtx.isVideoMuted()}
            fallback={<VideoCameraSlash class={iconClass} />}
          >
            <VideoCamera class={iconClass} />
          </Show>
        </CallControlButtonWithDropdown>

        <CallControlButton
          variant={resolvedVariant}
          onClick={() => callCtx.toggleScreenShare()}
          active={callCtx.isScreenSharing()}
          disabled={isConnecting()}
        >
          <Screencast class={iconClass} />
        </CallControlButton>

        <CallControlButton
          variant={resolvedVariant}
          onClick={onLeave}
          disabled={isConnecting()}
          danger
        >
          <PhoneDisconnect class={iconClass} />
        </CallControlButton>
      </div>
    </Show>
  );
}
