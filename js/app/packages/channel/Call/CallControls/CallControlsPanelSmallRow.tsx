import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import Gear from '@phosphor/gear.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import Screencast from '@phosphor/screencast.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import { cn, Dropdown } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { useCallContext } from '../CallContext';
import { CallDeviceList } from '../CallDeviceList';
import { useToggleShareWithTeam } from '../use-toggle-share-with-team';
import { InlineCheckbox, MenuDivider, MenuLabel } from './CallMenuPrimitives';

const ITEM_ICON_CLASS = 'size-3.5 shrink-0 text-ink-muted';

export function CallControlsPanelSmallRow() {
  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();
  const handleToggleShareWithTeam = useToggleShareWithTeam();
  const noiseSuppressionModeLabel = () =>
    match(callCtx.noiseSuppressionMode())
      .with('krisp', () => 'Krisp')
      .with('browser', () => 'Browser')
      .with('off', () => 'Off')
      .exhaustive();

  const anyMediaActive = () =>
    !callCtx.isAudioMuted() ||
    !callCtx.isVideoMuted() ||
    callCtx.isScreenSharing();

  return (
    <div
      data-call-controls
      data-call-controls-panel-small
      class="flex flex-row flex-wrap items-center justify-center gap-0.5"
    >
      <Dropdown placement="top-start" gutter={6}>
        <DropdownMenu.Trigger
          disabled={isConnecting()}
          aria-label="Call options"
          class={cn(
            'flex items-center justify-center size-5 shrink-0 rounded-md transition-colors',
            isConnecting() && 'opacity-50 pointer-events-none',
            !isConnecting() && anyMediaActive() ? 'text-ink' : 'text-ink-muted',
            !isConnecting() && 'hover:text-ink hover:bg-ink-muted/[0.06]'
          )}
        >
          <Gear class="size-4" />
        </DropdownMenu.Trigger>

        <Dropdown.Content class="min-w-56">
          <Dropdown.Group>
            <Dropdown.Item
              closeOnSelect={false}
              onSelect={() => void callCtx.toggleAudio()}
            >
              <Show
                when={!callCtx.isAudioMuted()}
                fallback={<MicrophoneSlash class={ITEM_ICON_CLASS} />}
              >
                <Microphone class={ITEM_ICON_CLASS} />
              </Show>
              <span class="flex-1 truncate">
                {callCtx.isAudioMuted()
                  ? 'Unmute microphone'
                  : 'Mute microphone'}
              </span>
            </Dropdown.Item>

            <MenuDivider />

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

            <MenuDivider />

            <Dropdown.Item
              closeOnSelect={false}
              onSelect={() => void callCtx.toggleVideo()}
            >
              <Show
                when={!callCtx.isVideoMuted()}
                fallback={<VideoCameraSlash class={ITEM_ICON_CLASS} />}
              >
                <VideoCamera class={ITEM_ICON_CLASS} />
              </Show>
              <span class="flex-1 truncate">
                {callCtx.isVideoMuted() ? 'Turn camera on' : 'Turn camera off'}
              </span>
            </Dropdown.Item>

            <MenuDivider />

            <CallDeviceList
              label="Camera"
              devices={callCtx.videoInputDevices()}
              activeDeviceId={callCtx.activeVideoInputDeviceId()}
              onSelect={(id) => callCtx.switchVideoInput(id)}
            />

            <MenuDivider />

            <Dropdown.Item
              closeOnSelect={false}
              onSelect={() => void callCtx.toggleScreenShare()}
            >
              <Screencast class={ITEM_ICON_CLASS} />
              <span class="flex-1 truncate">
                {callCtx.isScreenSharing()
                  ? 'Stop sharing screen'
                  : 'Share screen'}
              </span>
            </Dropdown.Item>

            <Dropdown.Item
              closeOnSelect={false}
              onSelect={() => void handleToggleShareWithTeam()}
            >
              <InlineCheckbox checked={callCtx.isSharedWithTeam()} />
              <span class="flex-1 truncate">Share with team</span>
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
