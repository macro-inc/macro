import PhoneDisconnect from '@icon/wide-call-disconnect.svg';
import CheckIcon from '@phosphor/check.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import Screencast from '@phosphor/screencast.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import { cn, Dropdown } from '@ui';
import { type Accessor, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { useCallContext } from '../CallContext';
import { CallDeviceList } from '../CallDeviceList';
import {
  CallControlButton,
  type CallControlButtonSize,
} from './CallControlButton';
import { CallControlButtonWithDropdown } from './CallControlButtonWithDropdown';

export type CallControlsDefaultAndPanelRowProps = {
  size: Accessor<CallControlButtonSize>;
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

const BACKGROUND_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'blur-light', label: 'Small blur' },
  { value: 'blur-medium', label: 'Medium blur' },
  { value: 'blur-heavy', label: 'Large blur' },
] as const;

type BackgroundOptionValue = (typeof BACKGROUND_OPTIONS)[number]['value'];

function BackgroundEffectSelector() {
  const callCtx = useCallContext();

  const currentEffectValue = (): BackgroundOptionValue | '' => {
    const effect = callCtx.backgroundEffect();
    if (effect.type === 'none') return 'none';
    if (effect.type === 'blur') return `blur-${effect.intensity}`;
    return '';
  };

  const handleChange = (value: string) => {
    if (value === 'none') {
      callCtx.setBackgroundEffect({ type: 'none' });
      return;
    }

    if (value.startsWith('blur-')) {
      const intensity = value.replace('blur-', '') as
        | 'light'
        | 'medium'
        | 'heavy';

      callCtx.setBackgroundEffect({ type: 'blur', intensity });
    }
  };

  return (
    <Dropdown.RadioGroup value={currentEffectValue()} onChange={handleChange}>
      <Dropdown.Group>
        <Dropdown.GroupLabel>Background</Dropdown.GroupLabel>
        <For each={BACKGROUND_OPTIONS}>
          {(option) => (
            <Dropdown.RadioItem value={option.value}>
              <span class="flex-1 truncate">{option.label}</span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
          )}
        </For>
      </Dropdown.Group>
    </Dropdown.RadioGroup>
  );
}

export function CallControlsDefaultAndPanelRow(
  props: CallControlsDefaultAndPanelRowProps
) {
  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();
  const size = () => props.size();
  const iconClass = () => (size() === 'sm' ? 'w-4 h-4' : 'w-5 h-5');
  const noiseSuppressionModeLabel = () =>
    match(callCtx.noiseSuppressionMode())
      .with('krisp', () => 'Krisp')
      .with('browser', () => 'Browser')
      .with('off', () => 'Off')
      .exhaustive();

  return (
    <div
      data-call-controls
      class={cn(
        'flex flex-row flex-wrap items-center',
        size() === 'md' && 'justify-center gap-3',
        size() === 'sm' && 'justify-around gap-0 py-1',
        props.class
      )}
    >
      <CallControlButtonWithDropdown
        size={size()}
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
              <CallDeviceList
                label="Speaker"
                devices={callCtx.audioOutputDevices()}
                activeDeviceId={callCtx.activeAudioOutputDeviceId()}
                onSelect={(id) => callCtx.switchAudioOutput(id)}
              />
            </Show>
            <Dropdown.Group>
              <Dropdown.GroupLabel>Audio processing</Dropdown.GroupLabel>
              <Dropdown.CheckboxItem
                checked={callCtx.isNoiseSuppressed()}
                closeOnSelect={false}
                onChange={() => void callCtx.toggleNoiseSuppression()}
              >
                <span class="flex-1 truncate">Noise suppression</span>
                <span class="text-xs text-ink-muted">
                  {noiseSuppressionModeLabel()}
                </span>
              </Dropdown.CheckboxItem>
            </Dropdown.Group>
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
        size={size()}
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
              <BackgroundEffectSelector />
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
        class="border-0"
        size={size()}
        onClick={() => callCtx.toggleScreenShare()}
        active={callCtx.isScreenSharing()}
        disabled={isConnecting()}
      >
        <Screencast class={iconClass()} />
      </CallControlButton>

      <CallControlButton
        class="border-0"
        size={size()}
        onClick={props.onLeave}
        disabled={isConnecting()}
        danger
      >
        <PhoneDisconnect class={iconClass()} />
      </CallControlButton>
    </div>
  );
}
