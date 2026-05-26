import PhoneDisconnect from '@icon/wide-call-disconnect.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import Gear from '@phosphor/gear.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import Screencast from '@phosphor/screencast.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import { Button, Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { BACKGROUND_IMAGES, useCallContext } from '../CallContext';
import { CallDeviceList } from '../CallDeviceList';

import { MenuDivider, MenuLabel } from './CallMenuPrimitives';

export type CallControlsDefaultAndPanelRowProps = {
  onLeave: () => void | Promise<void>;
};

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

function Cell(props: { children: JSX.Element }) {
  return <div class="flex items-center p-1">{props.children}</div>;
}

/**
 * Mic / camera / screen-share / settings / hang-up arranged as a single
 * rounded card with hairline dividers — matches the in-call sidebar panel
 * styling. Each cell holds a plain ghost `Button`, so the hover stays
 * contained inside the button rather than filling the cell to the dividers.
 */
export function CallControlsDefaultAndPanelRow(
  props: CallControlsDefaultAndPanelRowProps
) {
  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();
  const noiseSuppressionModeLabel = () =>
    match(callCtx.noiseSuppressionMode())
      .with('krisp', () => 'Krisp')
      .with('browser', () => 'Browser')
      .with('off', () => 'Off')
      .exhaustive();

  return (
    <div class="inline-flex items-center overflow-hidden rounded-lg border border-ink-muted/[0.08] bg-ink-muted/[0.025] divide-x divide-ink-muted/[0.08]">
      <Cell>
        <Button
          size="icon-sm"
          onClick={() => void callCtx.toggleAudio()}
          disabled={isConnecting()}
          aria-label={
            callCtx.isAudioMuted() ? 'Unmute microphone' : 'Mute microphone'
          }
          aria-pressed={!callCtx.isAudioMuted()}
        >
          <Show when={!callCtx.isAudioMuted()} fallback={<MicrophoneSlash />}>
            <Microphone />
          </Show>
        </Button>
      </Cell>

      <Cell>
        <Button
          size="icon-sm"
          onClick={() => void callCtx.toggleVideo()}
          disabled={isConnecting()}
          aria-label={
            callCtx.isVideoMuted() ? 'Turn on camera' : 'Turn off camera'
          }
          aria-pressed={!callCtx.isVideoMuted()}
        >
          <Show when={!callCtx.isVideoMuted()} fallback={<VideoCameraSlash />}>
            <VideoCamera />
          </Show>
        </Button>
      </Cell>

      <Cell>
        <Button
          size="icon-sm"
          onClick={() => void callCtx.toggleScreenShare()}
          disabled={isConnecting()}
          aria-label={
            callCtx.isScreenSharing() ? 'Stop sharing screen' : 'Share screen'
          }
          aria-pressed={callCtx.isScreenSharing()}
        >
          <Screencast />
        </Button>
      </Cell>

      <Cell>
        <Dropdown placement="top" gutter={6}>
          <DropdownMenu.Trigger
            as={Button}
            size="icon-sm"
            disabled={isConnecting()}
            aria-label="Call settings"
          >
            <Gear />
          </DropdownMenu.Trigger>
          <Dropdown.Content class="min-w-56">
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
              <CallDeviceList
                label="Camera"
                devices={callCtx.videoInputDevices()}
                activeDeviceId={callCtx.activeVideoInputDeviceId()}
                onSelect={(id) => callCtx.switchVideoInput(id)}
              />
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
              <Show when={isBackgroundBlurSupported()}>
                <MenuDivider />
                <BackgroundEffectSelector />
              </Show>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </Cell>

      <Cell>
        <Button
          size="icon-sm"
          class="text-failure not-disabled:hover:text-failure not-disabled:hover:bg-failure/10"
          onClick={() => void props.onLeave()}
          disabled={isConnecting()}
          aria-label="Leave call"
        >
          <PhoneDisconnect />
        </Button>
      </Cell>
    </div>
  );
}
