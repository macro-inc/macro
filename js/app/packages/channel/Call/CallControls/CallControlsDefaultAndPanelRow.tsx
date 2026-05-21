import PhoneDisconnect from '@icon/wide-call-disconnect.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import CaretDown from '@phosphor/caret-down.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import Screencast from '@phosphor/screencast.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import { cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { BACKGROUND_IMAGES, useCallContext } from '../CallContext';
import { CallDeviceList } from '../CallDeviceList';

import { MenuDivider, MenuLabel } from './CallMenuPrimitives';

export type CallControlsSize = 'sm' | 'md';

export type CallControlsDefaultAndPanelRowProps = {
  size: CallControlsSize;
  onLeave: () => void | Promise<void>;
};

// Pill row class tokens.
const CELL_BASE =
  'flex items-center justify-center min-w-0 flex-1 transition-colors disabled:pointer-events-none disabled:opacity-50';
const CELL_INTERACTIVE =
  'text-ink-muted/70 hover:text-ink hover:bg-ink-muted/[0.06]';
const CELL_INTERACTIVE_ACTIVE = 'text-ink hover:bg-ink-muted/[0.06]';
const CELL_DANGER = 'text-failure hover:bg-failure/[0.08]';
// Chevron cells are narrower than icon cells — give them ~half the flex
// so the row reads as 4 controls with affordances rather than 6 equal slots.
const CHEVRON_CELL = 'basis-0 grow-[0.5]';
// Group divider — drawn only between the 4 logical controls, not between
// an icon and its own chevron. Lets the chevron read as paired affordance.
const GROUP_DIVIDER = 'border-l border-ink-muted/[0.08]';

// Mirrors @livekit/track-processors' supportsBackgroundProcessors() so this
// menu can render without statically importing heavy processor bundles.
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
      <MenuLabel>Background</MenuLabel>
      <Dropdown.RadioItem value="none">None</Dropdown.RadioItem>
      <MenuDivider />
      <MenuLabel>Blur</MenuLabel>
      <Dropdown.RadioItem value="blur-light">Light</Dropdown.RadioItem>
      <Dropdown.RadioItem value="blur-medium">Medium</Dropdown.RadioItem>
      <Dropdown.RadioItem value="blur-heavy">Heavy</Dropdown.RadioItem>
      <Show when={BACKGROUND_IMAGES.length}>
        <MenuDivider />
        <MenuLabel>Image</MenuLabel>
        <For each={BACKGROUND_IMAGES}>
          {(bg) => (
            <Dropdown.RadioItem value={`image-${bg.id}`}>
              {bg.label}
            </Dropdown.RadioItem>
          )}
        </For>
      </Show>
    </Dropdown.RadioGroup>
  );
}

/**
 * Mic / camera / screen-share / hang-up arranged as a single rounded pill
 * with hairline dividers between the four logical controls. The mic and
 * camera each have an inline chevron that opens the device / processing
 * menu, visually paired to its icon (no divider between them).
 *
 * Cell order: [mic] [▾] [cam] [▾] [share] [hangup]
 */
export function CallControlsDefaultAndPanelRow(
  props: CallControlsDefaultAndPanelRowProps
) {
  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();
  const iconClass = () => (props.size === 'sm' ? 'w-4 h-4' : 'w-5 h-5');
  const heightClass = () => (props.size === 'sm' ? 'h-7' : 'h-9');
  const radiusClass = () => (props.size === 'sm' ? 'rounded-md' : 'rounded-lg');
  const chevronIconClass = () => (props.size === 'sm' ? 'size-2.5' : 'size-3');
  const noiseSuppressionModeLabel = () =>
    match(callCtx.noiseSuppressionMode())
      .with('krisp', () => 'Krisp')
      .with('browser', () => 'Browser')
      .with('off', () => 'Off')
      .exhaustive();

  const audioMenuContent = () => (
    <Dropdown.Group>
      <CallDeviceList
        label="Microphone"
        devices={callCtx.audioInputDevices()}
        activeDeviceId={callCtx.activeAudioInputDeviceId()}
        onSelect={(id) => callCtx.switchAudioInput(id)}
      />
      <Show when={callCtx.audioOutputDevices().length > 0}>
        <MenuDivider />
        <CallDeviceList
          label="Speaker"
          devices={callCtx.audioOutputDevices()}
          activeDeviceId={callCtx.activeAudioOutputDeviceId()}
          onSelect={(id) => callCtx.switchAudioOutput(id)}
        />
      </Show>
      <MenuDivider />
      <MenuLabel>Audio processing</MenuLabel>
      <Dropdown.Item
        closeOnSelect={false}
        onSelect={() => void callCtx.toggleNoiseSuppression()}
      >
        <span class="flex-1 truncate">Noise suppression</span>
        <span class="text-xs text-ink-muted">
          {noiseSuppressionModeLabel()}
        </span>
      </Dropdown.Item>
    </Dropdown.Group>
  );

  const videoMenuContent = () => (
    <Dropdown.Group>
      <CallDeviceList
        label="Camera"
        devices={callCtx.videoInputDevices()}
        activeDeviceId={callCtx.activeVideoInputDeviceId()}
        onSelect={(id) => callCtx.switchVideoInput(id)}
      />
      <Show when={isBackgroundBlurSupported()}>
        <MenuDivider />
        <BackgroundEffectSelector />
      </Show>
    </Dropdown.Group>
  );

  return (
    <div
      data-call-controls
      class={cn(
        'flex items-stretch w-fit max-w-full mx-auto border border-ink-muted/[0.08] bg-ink-muted/[0.025] overflow-hidden',
        heightClass(),
        radiusClass()
      )}
    >
      {/* Mic toggle — tight right padding so chevron reads paired */}
      <button
        type="button"
        onClick={() => void callCtx.toggleAudio()}
        disabled={isConnecting()}
        aria-label={
          callCtx.isAudioMuted() ? 'Unmute microphone' : 'Mute microphone'
        }
        aria-pressed={!callCtx.isAudioMuted()}
        class={cn(
          CELL_BASE,
          'pl-3 pr-1.5',
          callCtx.isAudioMuted() ? CELL_INTERACTIVE : CELL_INTERACTIVE_ACTIVE
        )}
      >
        <Show
          when={!callCtx.isAudioMuted()}
          fallback={<MicrophoneSlash class={iconClass()} />}
        >
          <Microphone class={iconClass()} />
        </Show>
      </button>

      {/* Mic device menu */}
      <Dropdown placement="top" gutter={6}>
        <DropdownMenu.Trigger
          disabled={isConnecting()}
          aria-label="Microphone settings"
          class={cn(CELL_BASE, CHEVRON_CELL, 'pl-0 pr-1.5', CELL_INTERACTIVE)}
        >
          <CaretDown class={chevronIconClass()} />
        </DropdownMenu.Trigger>
        <Dropdown.Content class="min-w-56">
          {audioMenuContent()}
        </Dropdown.Content>
      </Dropdown>

      {/* Camera toggle */}
      <button
        type="button"
        onClick={() => void callCtx.toggleVideo()}
        disabled={isConnecting()}
        aria-label={
          callCtx.isVideoMuted() ? 'Turn on camera' : 'Turn off camera'
        }
        aria-pressed={!callCtx.isVideoMuted()}
        class={cn(
          CELL_BASE,
          GROUP_DIVIDER,
          'pl-3 pr-1.5',
          callCtx.isVideoMuted() ? CELL_INTERACTIVE : CELL_INTERACTIVE_ACTIVE
        )}
      >
        <Show
          when={!callCtx.isVideoMuted()}
          fallback={<VideoCameraSlash class={iconClass()} />}
        >
          <VideoCamera class={iconClass()} />
        </Show>
      </button>

      {/* Camera device menu */}
      <Dropdown placement="top" gutter={6}>
        <DropdownMenu.Trigger
          disabled={isConnecting()}
          aria-label="Camera settings"
          class={cn(CELL_BASE, CHEVRON_CELL, 'pl-0 pr-1.5', CELL_INTERACTIVE)}
        >
          <CaretDown class={chevronIconClass()} />
        </DropdownMenu.Trigger>
        <Dropdown.Content class="min-w-56">
          {videoMenuContent()}
        </Dropdown.Content>
      </Dropdown>

      {/* Screen share */}
      <button
        type="button"
        onClick={() => void callCtx.toggleScreenShare()}
        disabled={isConnecting()}
        aria-label={
          callCtx.isScreenSharing() ? 'Stop sharing screen' : 'Share screen'
        }
        aria-pressed={callCtx.isScreenSharing()}
        class={cn(
          CELL_BASE,
          GROUP_DIVIDER,
          'px-3',
          callCtx.isScreenSharing() ? CELL_INTERACTIVE_ACTIVE : CELL_INTERACTIVE
        )}
      >
        <Screencast class={iconClass()} />
      </button>

      {/* Hang up */}
      <button
        type="button"
        onClick={() => void props.onLeave()}
        disabled={isConnecting()}
        aria-label="Leave call"
        class={cn(CELL_BASE, GROUP_DIVIDER, 'px-3', CELL_DANGER)}
      >
        <PhoneDisconnect class={iconClass()} />
      </button>
    </div>
  );
}
