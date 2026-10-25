import { BlurIcon } from '@core/component/media/media-background-picker';
import { MediaDeviceRadioItems } from '@core/component/media/media-device-picker';
import type { BackgroundEffect } from '@core/media/background-effect';
import { readBackgroundImage } from '@core/media/read-background-image';
import { fireAndForget } from '@core/util/fireAndForget';
import Image from '@phosphor/image.svg';
import Prohibit from '@phosphor/prohibit.svg';
import Upload from '@phosphor/upload-simple.svg';
import { Dropdown } from '@ui';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import type { CallState } from '../CallContext';
import { CallControlBar } from './CallControlBar';

export type CallMediaControlsState = Pick<
  CallState,
  | 'isConnecting'
  | 'isAudioMuted'
  | 'isVideoMuted'
  | 'isScreenSharing'
  | 'toggleAudio'
  | 'toggleVideo'
  | 'toggleScreenShare'
  | 'audioInputDevices'
  | 'audioOutputDevices'
  | 'videoInputDevices'
  | 'activeAudioInputDeviceId'
  | 'activeAudioOutputDeviceId'
  | 'activeVideoInputDeviceId'
  | 'switchAudioInput'
  | 'switchAudioOutput'
  | 'switchVideoInput'
  | 'isNoiseSuppressed'
  | 'toggleNoiseSuppression'
  | 'backgroundEffect'
  | 'setBackgroundEffect'
>;

type BackgroundChoice = 'none' | 'light' | 'heavy' | 'image';

function backgroundChoice(effect: BackgroundEffect): BackgroundChoice {
  if (effect.type === 'blur')
    return effect.intensity === 'light' ? 'light' : 'heavy';
  return effect.type;
}

export function CallMediaControls(props: {
  media: CallMediaControlsState;
  onLeave: () => void | Promise<void>;
}) {
  const call = props.media;
  const [applyingBackground, setApplyingBackground] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let upload: HTMLInputElement | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function run(action: () => void | Promise<void>) {
    setError(undefined);
    try {
      await action();
    } catch (error) {
      if (!disposed)
        setError(
          error instanceof Error
            ? error.message
            : 'Could not update call settings.'
        );
    }
  }
  const fire = (action: () => void | Promise<void>) =>
    fireAndForget(run(action), 'channel-call');

  async function applyBackground(effect: BackgroundEffect | File) {
    if (applyingBackground()) return;
    setApplyingBackground(true);
    await run(async () => {
      const next =
        effect instanceof File
          ? {
              type: 'image' as const,
              id: 'custom',
              path: await readBackgroundImage(effect),
            }
          : effect;
      if (!disposed) await call.setBackgroundEffect(next);
    });
    if (!disposed) setApplyingBackground(false);
  }
  async function selectBackground(value: string) {
    if (value === 'none') await applyBackground({ type: 'none' });
    else if (value === 'light' || value === 'heavy')
      await applyBackground({ type: 'blur', intensity: value });
  }

  const backgroundDisabled = () => call.isConnecting() || applyingBackground();

  return (
    <>
      <CallControlBar
        disabled={call.isConnecting()}
        audioMuted={call.isAudioMuted()}
        videoMuted={call.isVideoMuted()}
        screenSharing={call.isScreenSharing()}
        onToggleAudio={() => fire(call.toggleAudio)}
        onToggleVideo={() => fire(call.toggleVideo)}
        onToggleScreen={() => fire(call.toggleScreenShare)}
        onLeave={() => fire(props.onLeave)}
        error={error()}
        audioMenu={
          <>
            <Dropdown.Group>
              <Dropdown.GroupLabel>Microphone</Dropdown.GroupLabel>
              <MediaDeviceRadioItems
                label="Microphone"
                devices={call.audioInputDevices()}
                selected={call.activeAudioInputDeviceId() ?? ''}
                disabled={call.isConnecting()}
                onSelect={(id) =>
                  fire(() => call.switchAudioInput(id || 'default'))
                }
              />
            </Dropdown.Group>
            <Show when={'setSinkId' in HTMLMediaElement.prototype}>
              <Dropdown.Separator />
              <Dropdown.Group>
                <Dropdown.GroupLabel>Speaker</Dropdown.GroupLabel>
                <MediaDeviceRadioItems
                  label="Speaker"
                  devices={call.audioOutputDevices()}
                  selected={call.activeAudioOutputDeviceId() ?? ''}
                  disabled={call.isConnecting()}
                  onSelect={(id) =>
                    fire(() => call.switchAudioOutput(id || 'default'))
                  }
                />
              </Dropdown.Group>
            </Show>
            <Dropdown.Separator />
            <Dropdown.Group>
              <Dropdown.CheckboxItem
                checked={call.isNoiseSuppressed()}
                disabled={call.isConnecting()}
                closeOnSelect={false}
                onChange={() => fire(call.toggleNoiseSuppression)}
              >
                Noise suppression
              </Dropdown.CheckboxItem>
            </Dropdown.Group>
          </>
        }
        videoMenu={
          <>
            <Dropdown.Group>
              <Dropdown.GroupLabel>Camera</Dropdown.GroupLabel>
              <MediaDeviceRadioItems
                label="Camera"
                devices={call.videoInputDevices()}
                selected={call.activeVideoInputDeviceId() ?? ''}
                disabled={call.isConnecting()}
                onSelect={(id) =>
                  fire(() =>
                    call.switchVideoInput(
                      id || call.videoInputDevices()[0]?.deviceId || ''
                    )
                  )
                }
              />
            </Dropdown.Group>
            <Dropdown.Separator />
            <Dropdown.Group>
              <Dropdown.GroupLabel>Background</Dropdown.GroupLabel>
              <div class="grid grid-cols-4 gap-1">
                <Dropdown.RadioGroup
                  class="contents"
                  value={backgroundChoice(call.backgroundEffect())}
                  onChange={(value) =>
                    fireAndForget(selectBackground(value), 'channel-call')
                  }
                >
                  <BackgroundTile
                    value="none"
                    label="None"
                    disabled={backgroundDisabled()}
                  >
                    <Prohibit class="size-4" />
                  </BackgroundTile>
                  <BackgroundTile
                    value="light"
                    label="Light blur"
                    caption="Light"
                    disabled={backgroundDisabled()}
                  >
                    <BlurIcon />
                  </BackgroundTile>
                  <BackgroundTile
                    value="heavy"
                    label="Strong blur"
                    caption="Strong"
                    disabled={backgroundDisabled()}
                  >
                    <BlurIcon strong />
                  </BackgroundTile>
                  <Show when={call.backgroundEffect().type === 'image'}>
                    <BackgroundTile
                      value="image"
                      label="Custom image"
                      caption="Custom"
                    >
                      <Image class="size-4" />
                    </BackgroundTile>
                  </Show>
                </Dropdown.RadioGroup>
                <Dropdown.Item
                  disabled={backgroundDisabled()}
                  onSelect={() => upload?.click()}
                  class="aspect-[4/3] flex-col justify-center gap-1 border border-dashed border-edge-muted p-1 text-xs text-ink-muted"
                >
                  <Upload class="size-4" />
                  <span>{applyingBackground() ? 'Loading…' : 'Upload'}</span>
                </Dropdown.Item>
              </div>
            </Dropdown.Group>
          </>
        }
      />
      <input
        ref={upload}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload background image"
        class="sr-only"
        tabindex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) fireAndForget(applyBackground(file), 'channel-call');
        }}
      />
    </>
  );
}

/** One background choice as a small tile; `caption` shortens the visible name. */
function BackgroundTile(props: {
  value: BackgroundChoice;
  label: string;
  caption?: string;
  disabled?: boolean;
  children: JSX.Element;
}) {
  return (
    <Dropdown.RadioItem
      value={props.value}
      disabled={props.disabled}
      class="aspect-[4/3] flex-col justify-center gap-1 border border-edge-muted p-1 text-center text-xs text-ink-muted data-checked:overlay-active data-checked:text-ink"
    >
      {props.children}
      <Dropdown.ItemLabel class="sr-only">{props.label}</Dropdown.ItemLabel>
      <span aria-hidden="true">{props.caption ?? props.label}</span>
    </Dropdown.RadioItem>
  );
}
