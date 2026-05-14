import {
  GroupLabel,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import Microphone from '@icon/regular/microphone.svg';
import MicrophoneSlash from '@icon/regular/microphone-slash.svg';
import Screencast from '@icon/regular/screencast.svg';
import VideoCamera from '@icon/regular/video-camera.svg';
import VideoCameraSlash from '@icon/regular/video-camera-slash.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import PhoneDisconnect from '@macro-icons/wide/call-disconnect.svg';
import { cn } from '@ui';
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
    <DropdownMenu.RadioGroup
      class="w-full"
      value={currentEffectValue()}
      onChange={handleChange}
    >
      <MenuGroup>
        <GroupLabel>Background</GroupLabel>
        <MenuItem
          text="None"
          selectorType="radio"
          value="none"
          groupValue={currentEffectValue()}
        />
      </MenuGroup>
      <MenuGroup>
        <GroupLabel>Blur</GroupLabel>
        <MenuItem
          text="Light"
          selectorType="radio"
          value="blur-light"
          groupValue={currentEffectValue()}
        />
        <MenuItem
          text="Medium"
          selectorType="radio"
          value="blur-medium"
          groupValue={currentEffectValue()}
        />
        <MenuItem
          text="Heavy"
          selectorType="radio"
          value="blur-heavy"
          groupValue={currentEffectValue()}
        />
      </MenuGroup>
      <Show when={BACKGROUND_IMAGES.length}>
        <MenuGroup>
          <GroupLabel>Image</GroupLabel>
          <For each={BACKGROUND_IMAGES}>
            {(bg) => (
              <MenuItem
                text={bg.label}
                selectorType="radio"
                value={`image-${bg.id}`}
                groupValue={currentEffectValue()}
              />
            )}
          </For>
        </MenuGroup>
      </Show>
    </DropdownMenu.RadioGroup>
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
              <MenuSeparator />
              <CallDeviceList
                label="Speaker"
                devices={callCtx.audioOutputDevices()}
                activeDeviceId={callCtx.activeAudioOutputDeviceId()}
                onSelect={(id) => callCtx.switchAudioOutput(id)}
              />
            </Show>
            <MenuSeparator />
            <MenuGroup>
              <GroupLabel>Audio processing</GroupLabel>
              <MenuItem
                text={
                  <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span>Noise suppression</span>
                    <span class="text-xs text-ink-muted">
                      {noiseSuppressionModeLabel()}
                    </span>
                  </div>
                }
                selectorType="checkbox"
                checked={callCtx.isNoiseSuppressed()}
                closeOnSelect={false}
                onClick={() => void callCtx.toggleNoiseSuppression()}
              />
            </MenuGroup>
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
              <MenuSeparator />
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
