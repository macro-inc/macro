import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { BlurIcon } from '@core/component/media/media-background-picker';
import { MediaDeviceRadioItems } from '@core/component/media/media-device-picker';
import type { BackgroundEffect } from '@core/media/background-effect';
import { readBackgroundImage } from '@core/media/read-background-image';
import { fireAndForget } from '@core/util/fireAndForget';
import Image from '@icon/system/regular/image.svg';
import Prohibit from '@icon/system/regular/prohibit.svg';
import Upload from '@icon/system/regular/upload-simple.svg';
import { Dropdown, SingleSelectCheck, ToggleSwitch } from '@ui';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
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
  | 'shareScreenAudio'
  | 'setShareScreenAudio'
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
  screenUnavailable?: boolean;
  onLeave: () => void | Promise<void>;
  onSettingsOpenChange?: (open: boolean) => void;
  compact?: boolean;
  unframed?: boolean;
  canLeave?: boolean;
  children?: JSX.Element;
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
  const selectMicrophone = (id: string) =>
    fire(() => call.switchAudioInput(id || 'default'));
  const selectSpeaker = (id: string) =>
    fire(() => call.switchAudioOutput(id || 'default'));
  const selectCamera = (id: string) =>
    fire(() =>
      call.switchVideoInput(id || call.videoInputDevices()[0]?.deviceId || '')
    );

  return (
    <>
      <CallControlBar
        compact={props.compact}
        unframed={props.unframed}
        canLeave={props.canLeave}
        onSettingsOpenChange={props.onSettingsOpenChange}
        disabled={call.isConnecting()}
        audioMuted={call.isAudioMuted()}
        videoMuted={call.isVideoMuted()}
        screenSharing={call.isScreenSharing()}
        screenUnavailable={props.screenUnavailable}
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
                onSelect={selectMicrophone}
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
                  onSelect={selectSpeaker}
                />
              </Dropdown.Group>
            </Show>
            <Dropdown.Separator />
            <Dropdown.Group>
              <Dropdown.CheckboxItem
                class="flex-row-reverse"
                checked={call.isNoiseSuppressed()}
                disabled={call.isConnecting()}
                closeOnSelect={false}
                onChange={() => fire(call.toggleNoiseSuppression)}
                indicator={
                  <span inert aria-hidden="true">
                    <ToggleSwitch
                      size="md"
                      checked={call.isNoiseSuppressed()}
                    />
                  </span>
                }
              >
                <span class="flex-1">Noise suppression</span>
              </Dropdown.CheckboxItem>
            </Dropdown.Group>
          </>
        }
        screenMenu={
          <Dropdown.Group>
            <Dropdown.CheckboxItem
              checked={call.shareScreenAudio()}
              disabled={call.isConnecting() || call.isScreenSharing()}
              closeOnSelect={false}
              onChange={(checked) => call.setShareScreenAudio(checked)}
            >
              Share audio
            </Dropdown.CheckboxItem>
            <p class="px-2 pb-1 text-xs text-ink-muted">
              {call.isScreenSharing()
                ? 'Stop sharing to change this.'
                : 'Shares audio from a tab, or from your whole system where the browser supports it.'}
            </p>
          </Dropdown.Group>
        }
        screenDrawer={
          <>
            <MobileDrawer.Section>
              <ToggleSwitch
                size="md"
                label="Share audio"
                labelClass="order-first flex-1"
                class="min-h-11 w-full px-3 py-2.5 text-sm"
                checked={call.shareScreenAudio()}
                disabled={call.isConnecting() || call.isScreenSharing()}
                onChange={(checked) => call.setShareScreenAudio(checked)}
              />
            </MobileDrawer.Section>
            <p class="mt-2 px-3 text-xs text-ink-muted">
              {call.isScreenSharing()
                ? 'Stop sharing to change this.'
                : 'Shares audio from a tab, or from your whole system where the browser supports it.'}
            </p>
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
                onSelect={selectCamera}
              />
            </Dropdown.Group>
            <Dropdown.Separator />
            <Dropdown.Group>
              <Dropdown.GroupLabel>Background</Dropdown.GroupLabel>
              <div class="grid grid-cols-3 gap-2">
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
        audioDrawer={
          <div class="space-y-4">
            <div>
              <MobileDrawer.Label>Microphone</MobileDrawer.Label>
              <MobileDrawer.Section>
                <DeviceDrawerOptions
                  label="Microphone"
                  devices={call.audioInputDevices()}
                  selected={call.activeAudioInputDeviceId() ?? ''}
                  disabled={call.isConnecting()}
                  onSelect={selectMicrophone}
                />
              </MobileDrawer.Section>
            </div>
            <Show when={'setSinkId' in HTMLMediaElement.prototype}>
              <div>
                <MobileDrawer.Label>Speaker</MobileDrawer.Label>
                <MobileDrawer.Section>
                  <DeviceDrawerOptions
                    label="Speaker"
                    devices={call.audioOutputDevices()}
                    selected={call.activeAudioOutputDeviceId() ?? ''}
                    disabled={call.isConnecting()}
                    onSelect={selectSpeaker}
                  />
                </MobileDrawer.Section>
              </div>
            </Show>
            <MobileDrawer.Section>
              <ToggleSwitch
                size="md"
                label="Noise suppression"
                labelClass="order-first flex-1"
                class="min-h-11 w-full px-3 py-2.5 text-sm"
                checked={call.isNoiseSuppressed()}
                disabled={call.isConnecting()}
                onChange={() => fire(call.toggleNoiseSuppression)}
              />
            </MobileDrawer.Section>
          </div>
        }
        videoDrawer={
          <div class="space-y-4">
            <div>
              <MobileDrawer.Label>Camera</MobileDrawer.Label>
              <MobileDrawer.Section>
                <DeviceDrawerOptions
                  label="Camera"
                  devices={call.videoInputDevices()}
                  selected={call.activeVideoInputDeviceId() ?? ''}
                  disabled={call.isConnecting()}
                  onSelect={selectCamera}
                />
              </MobileDrawer.Section>
            </div>
            <div>
              <MobileDrawer.Label>Background</MobileDrawer.Label>
              <MobileDrawer.Section role="radiogroup" aria-label="Background">
                <For
                  each={[
                    { value: 'none', label: 'None' },
                    { value: 'light', label: 'Light blur' },
                    { value: 'heavy', label: 'Strong blur' },
                  ]}
                >
                  {(option) => (
                    <MobileDrawer.Item
                      role="radio"
                      aria-checked={
                        backgroundChoice(call.backgroundEffect()) ===
                        option.value
                      }
                      disabled={backgroundDisabled()}
                      onClick={() =>
                        fireAndForget(
                          selectBackground(option.value),
                          'channel-call'
                        )
                      }
                    >
                      <span class="flex-1">{option.label}</span>
                      <SingleSelectCheck
                        active={
                          backgroundChoice(call.backgroundEffect()) ===
                          option.value
                        }
                      />
                    </MobileDrawer.Item>
                  )}
                </For>
                <Show when={call.backgroundEffect().type === 'image'}>
                  <MobileDrawer.Item
                    role="radio"
                    aria-checked="true"
                    disabled={backgroundDisabled()}
                  >
                    <Image class="size-4" />
                    <span class="flex-1">Custom image</span>
                    <SingleSelectCheck active />
                  </MobileDrawer.Item>
                </Show>
              </MobileDrawer.Section>
              <MobileDrawer.Section class="mt-2">
                <MobileDrawer.Item
                  disabled={backgroundDisabled()}
                  onClick={() => upload?.click()}
                >
                  <Upload class="size-4" />
                  <span>
                    {applyingBackground() ? 'Loading…' : 'Upload image'}
                  </span>
                </MobileDrawer.Item>
              </MobileDrawer.Section>
            </div>
          </div>
        }
      >
        {props.children}
      </CallControlBar>
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

function DeviceDrawerOptions(props: {
  label: string;
  devices: ReadonlyArray<Pick<MediaDeviceInfo, 'deviceId' | 'label'>>;
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const options = () => [
    { deviceId: '', label: 'System default' },
    ...props.devices
      .filter((device) => device.deviceId !== '')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `${props.label} ${index + 1}`,
      })),
  ];
  return (
    <div role="radiogroup" aria-label={props.label}>
      <For each={options()}>
        {(device) => (
          <MobileDrawer.Item
            role="radio"
            aria-checked={props.selected === device.deviceId}
            disabled={props.disabled}
            onClick={() => props.onSelect(device.deviceId)}
          >
            <span class="min-w-0 flex-1 truncate">{device.label}</span>
            <SingleSelectCheck active={props.selected === device.deviceId} />
          </MobileDrawer.Item>
        )}
      </For>
    </div>
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
