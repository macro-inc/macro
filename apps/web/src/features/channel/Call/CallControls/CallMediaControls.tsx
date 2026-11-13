import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { BackgroundCameraPreview } from '@core/component/media/background-camera-preview';
import { MediaDeviceRadioItems } from '@core/component/media/media-device-picker';
import { RecentBackgroundImages } from '@core/component/media/recent-background-images';
import type { BackgroundEffect } from '@core/media/background-effect';
import { fireAndForget } from '@core/util/fireAndForget';
import SpeakerIcon from '@icon/system/regular/speaker-high.svg';
import { Dropdown, SingleSelectCheck, ToggleSwitch, Tooltip } from '@ui';
import {
  createContext,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { createCallMediaPermissionHelp } from '../primitives/create-call-media-permission-help';
import {
  type CallMediaControlsState,
  createCallMediaSettings,
} from '../primitives/create-call-media-settings';
import { CallMediaPermissionHelp } from '../views/CallMediaPermissionHelp';
import { CallControlBar } from './CallControlBar';

export type { CallMediaControlsState } from '../primitives/create-call-media-settings';

type BackgroundChoice = 'none' | 'light' | 'heavy' | 'image';

function backgroundChoice(effect: BackgroundEffect): BackgroundChoice {
  if (effect.type === 'blur')
    return effect.intensity === 'light' ? 'light' : 'heavy';
  return effect.type;
}

function createMediaControlsState(call: CallMediaControlsState) {
  const permissionHelp = createCallMediaPermissionHelp(call);
  const {
    cameraTrack,
    applyingBackground,
    error,
    fire,
    applyBackground,
    selectBackground,
  } = createCallMediaSettings(call);
  let upload: HTMLInputElement | undefined;
  const shareAudioDescription = createUniqueId();
  const [shareAudioFocused, setShareAudioFocused] = createSignal(false);
  const shareAudioReason = () => {
    if (call.isScreenSharing()) return t('calls.stopSharingToChange');
    if (call.isConnecting()) return t('calls.availableOnceJoined');
    return undefined;
  };
  const backgroundDisabled = () => call.isConnecting() || applyingBackground();
  const selectMicrophone = (id: string) =>
    fire(() => call.switchAudioInput(id || 'default'));
  const selectSpeaker = (id: string) =>
    fire(() => call.switchAudioOutput(id || 'default'));
  const selectCamera = (id: string) =>
    fire(() =>
      call.switchVideoInput(id || call.videoInputDevices()[0]?.deviceId || '')
    );

  return {
    call,
    permissionHelp,
    cameraTrack,
    applyingBackground,
    error,
    fire,
    applyBackground,
    selectBackground,
    shareAudioDescription,
    shareAudioFocused,
    setShareAudioFocused,
    shareAudioReason,
    backgroundDisabled,
    selectMicrophone,
    selectSpeaker,
    selectCamera,
    openUpload: () => upload?.click(),
    setUpload: (element: HTMLInputElement) => {
      upload = element;
    },
  };
}

const MediaContext =
  createContext<ReturnType<typeof createMediaControlsState>>();
function useMediaControls() {
  const value = useContext(MediaContext);
  if (!value) throw new Error('Media controls require CallMediaControls.Root');
  return value;
}
function Root(props: {
  media: CallMediaControlsState;
  compact?: boolean;
  unframed?: boolean;
  smallIcons?: boolean;
  showShortcuts?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
  children?: JSX.Element;
}) {
  const state = createMediaControlsState(props.media);
  return (
    <MediaContext.Provider value={state}>
      <CallControlBar.Root
        compact={props.compact}
        unframed={props.unframed}
        smallIcons={props.smallIcons}
        showShortcuts={props.showShortcuts}
        disabled={props.media.isConnecting()}
        onSettingsOpenChange={props.onSettingsOpenChange}
      >
        {props.children}
        <CallControlBar.Error>{state.error()}</CallControlBar.Error>
      </CallControlBar.Root>
      <CallMediaPermissionHelp controller={state.permissionHelp} />
      <input
        ref={state.setUpload}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload background image"
        class="sr-only"
        tabindex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) fireAndForget(state.applyBackground(file), 'channel-call');
        }}
      />
    </MediaContext.Provider>
  );
}
function MicrophoneControl() {
  const { call, permissionHelp, fire, selectMicrophone, selectSpeaker } =
    useMediaControls();
  return (
    <CallControlBar.Microphone
      muted={call.isAudioMuted()}
      permission={call.microphonePermission?.()}
      onToggle={(event) =>
        fire(() =>
          permissionHelp.request('microphone', false, event.currentTarget)
        )
      }
      mobileContent={
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
    >
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
              <ToggleSwitch size="sm" checked={call.isNoiseSuppressed()} />
            </span>
          }
        >
          <span class="flex-1">Noise suppression</span>
        </Dropdown.CheckboxItem>
      </Dropdown.Group>
    </CallControlBar.Microphone>
  );
}
function CameraControl() {
  const {
    call,
    permissionHelp,
    fire,
    cameraTrack,
    backgroundDisabled,
    applyingBackground,
    applyBackground,
    selectBackground,
    selectCamera,
    openUpload,
  } = useMediaControls();
  return (
    <CallControlBar.Camera
      muted={call.isVideoMuted()}
      permission={call.cameraPermission?.()}
      onToggle={(event) =>
        fire(() => permissionHelp.request('camera', false, event.currentTarget))
      }
      mobileContent={
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
            <MobileDrawer.Section
              role="radiogroup"
              aria-label="Background"
              class="grid grid-cols-3 gap-2 p-2"
            >
              <For
                each={
                  [
                    { value: 'none', label: 'None', blur: 0 },
                    { value: 'light', label: 'Light', blur: 2 },
                    { value: 'heavy', label: 'Strong', blur: 5 },
                  ] as const
                }
              >
                {(option) => (
                  <MobileDrawer.Item
                    role="radio"
                    class="group flex-col gap-1 p-0 text-center text-xs"
                    data-checked={
                      backgroundChoice(call.backgroundEffect()) === option.value
                        ? ''
                        : undefined
                    }
                    aria-checked={
                      backgroundChoice(call.backgroundEffect()) === option.value
                    }
                    disabled={backgroundDisabled()}
                    onClick={() =>
                      fireAndForget(
                        selectBackground(option.value),
                        'channel-call'
                      )
                    }
                  >
                    <BackgroundCameraPreview
                      track={cameraTrack()}
                      blur={option.value === 'none' ? undefined : option.value}
                    />
                    <span>{option.label}</span>
                  </MobileDrawer.Item>
                )}
              </For>
            </MobileDrawer.Section>
            <RecentBackgroundImages
              phone
              effect={call.backgroundEffect()}
              disabled={backgroundDisabled()}
              uploading={applyingBackground()}
              onSelect={applyBackground}
              onUploadClick={() => openUpload()}
            />
          </div>
        </div>
      }
    >
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
        <div class="mx-2 grid grid-cols-3 gap-2">
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
              <BackgroundCameraPreview track={cameraTrack()} />
            </BackgroundTile>
            <BackgroundTile
              value="light"
              label="Light blur"
              caption="Light"
              disabled={backgroundDisabled()}
            >
              <BackgroundCameraPreview track={cameraTrack()} blur="light" />
            </BackgroundTile>
            <BackgroundTile
              value="heavy"
              label="Strong blur"
              caption="Strong"
              disabled={backgroundDisabled()}
            >
              <BackgroundCameraPreview track={cameraTrack()} blur="heavy" />
            </BackgroundTile>
          </Dropdown.RadioGroup>
          <RecentBackgroundImages
            embedded
            effect={call.backgroundEffect()}
            disabled={backgroundDisabled()}
            uploading={applyingBackground()}
            onSelect={applyBackground}
            onUploadClick={() => openUpload()}
          />
        </div>
      </Dropdown.Group>
    </CallControlBar.Camera>
  );
}
function ScreenControl(props: { unavailable?: boolean }) {
  const {
    call,
    fire,
    shareAudioReason,
    shareAudioFocused,
    setShareAudioFocused,
    shareAudioDescription,
  } = useMediaControls();
  return (
    <CallControlBar.Screen
      sharing={call.isScreenSharing()}
      unavailable={props.unavailable}
      onToggle={() => fire(call.toggleScreenShare)}
      mobileContent={
        <MobileDrawer.Section>
          <ToggleSwitch
            size="md"
            label={<ShareAudioLabel />}
            aria-label="Share audio"
            labelClass="order-first flex-1"
            class="min-h-11 w-full px-3 py-2.5 text-sm"
            checked={call.shareScreenAudio()}
            disabled={call.isConnecting() || call.isScreenSharing()}
            onChange={(checked) => call.setShareScreenAudio(checked)}
          />
        </MobileDrawer.Section>
      }
    >
      <Dropdown.Group>
        <Tooltip
          label={shareAudioReason() ?? ''}
          disabled={!shareAudioReason()}
          open={shareAudioFocused()}
          class="w-full"
          placement="top"
        >
          <Dropdown.CheckboxItem
            ref={(element: HTMLDivElement) => {
              const focus = () => setShareAudioFocused(true);
              const blur = () => setShareAudioFocused(false);
              element.addEventListener('focus', focus);
              element.addEventListener('blur', blur);
              onCleanup(() => {
                element.removeEventListener('focus', focus);
                element.removeEventListener('blur', blur);
              });
            }}
            class="flex-row-reverse"
            classList={{ 'opacity-50': !!shareAudioReason() }}
            aria-label="Share audio"
            aria-disabled={!!shareAudioReason()}
            aria-describedby={
              shareAudioReason() ? shareAudioDescription : undefined
            }
            checked={call.shareScreenAudio()}
            closeOnSelect={false}
            onChange={(checked) => {
              if (!shareAudioReason()) call.setShareScreenAudio(checked);
            }}
            indicator={
              <span inert aria-hidden="true">
                <ToggleSwitch
                  size="sm"
                  checked={call.shareScreenAudio()}
                  disabled={call.isConnecting() || call.isScreenSharing()}
                />
              </span>
            }
          >
            <ShareAudioLabel />
          </Dropdown.CheckboxItem>
          <span id={shareAudioDescription} class="sr-only">
            {shareAudioReason()}
          </span>
        </Tooltip>
      </Dropdown.Group>
    </CallControlBar.Screen>
  );
}
function LeaveControl(props: { onLeave: () => void | Promise<void> }) {
  const { fire } = useMediaControls();
  return <CallControlBar.Leave onLeave={() => fire(props.onLeave)} />;
}

export const CallMediaControls = {
  Root,
  Microphone: MicrophoneControl,
  Camera: CameraControl,
  Screen: ScreenControl,
  Leave: LeaveControl,
};

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
/** One background choice on the same grid as uploaded images. */
function BackgroundTile(props: {
  value: BackgroundChoice;
  label: string;
  caption?: string;
  disabled?: boolean;
  children: JSX.Element;
}) {
  return (
    <Tooltip label={props.label} class="block">
      <Dropdown.RadioItem
        value={props.value}
        disabled={props.disabled}
        class="group flex-col justify-center gap-1 p-0 text-center text-xs text-ink-muted data-checked:text-ink data-highlighted:bg-transparent focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span class="relative block w-full rounded-lg after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] group-data-highlighted:after:overlay-hover">
          {props.children}
        </span>
        <Dropdown.ItemLabel class="sr-only">{props.label}</Dropdown.ItemLabel>
      </Dropdown.RadioItem>
    </Tooltip>
  );
}

function ShareAudioLabel() {
  return (
    <span class="flex min-w-0 flex-1 items-center gap-2">
      <SpeakerIcon class="size-4 shrink-0" />
      <span class="flex-1 text-left">Share audio</span>
    </span>
  );
}
