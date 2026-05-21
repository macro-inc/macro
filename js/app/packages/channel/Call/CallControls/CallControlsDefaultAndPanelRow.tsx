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
import { BACKGROUND_IMAGES, useCallContext } from '../CallContext';
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

function BackgroundEffectSelector() {
  const callCtx = useCallContext();

  const currentEffectValue = () => {
    const effect = callCtx.backgroundEffect();
    if (effect.type === 'none') return 'none';
    if (effect.type === 'blur') return `blur-${effect.intensity}`;
    return `image-${effect.id}`;
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
      return;
    }

    if (value.startsWith('image-')) {
      const id = value.replace('image-', '');
      const bg = BACKGROUND_IMAGES.find((b) => b.id === id);

      if (!bg) return;

      callCtx.setBackgroundEffect({
        type: 'image',
        id: bg.id,
        path: bg.path,
      });
    }
  };

  return (
    <Dropdown.RadioGroup value={currentEffectValue()} onChange={handleChange}>
      <Dropdown.Group>
        <Dropdown.GroupLabel>Background</Dropdown.GroupLabel>
        <Dropdown.RadioItem value="none">
          <span class="flex-1 truncate">None</span>
          <Dropdown.ItemIndicator>
            <CheckIcon class="size-3.5 text-accent" />
          </Dropdown.ItemIndicator>
        </Dropdown.RadioItem>
      </Dropdown.Group>
      <Dropdown.Group>
        <Dropdown.GroupLabel>Blur</Dropdown.GroupLabel>
        <Dropdown.RadioItem value="blur-light">
          <span class="flex-1 truncate">Light</span>
          <Dropdown.ItemIndicator>
            <CheckIcon class="size-3.5 text-accent" />
          </Dropdown.ItemIndicator>
        </Dropdown.RadioItem>
        <Dropdown.RadioItem value="blur-medium">
          <span class="flex-1 truncate">Medium</span>
          <Dropdown.ItemIndicator>
            <CheckIcon class="size-3.5 text-accent" />
          </Dropdown.ItemIndicator>
        </Dropdown.RadioItem>
        <Dropdown.RadioItem value="blur-heavy">
          <span class="flex-1 truncate">Heavy</span>
          <Dropdown.ItemIndicator>
            <CheckIcon class="size-3.5 text-accent" />
          </Dropdown.ItemIndicator>
        </Dropdown.RadioItem>
      </Dropdown.Group>
      <Show when={BACKGROUND_IMAGES.length}>
        <Dropdown.Group>
          <Dropdown.GroupLabel>Image</Dropdown.GroupLabel>
          <For each={BACKGROUND_IMAGES}>
            {(bg) => (
              <Dropdown.RadioItem value={`image-${bg.id}`}>
                <span class="flex-1 truncate">{bg.label}</span>
                <Dropdown.ItemIndicator>
                  <CheckIcon class="size-3.5 text-accent" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            )}
          </For>
        </Dropdown.Group>
      </Show>
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
