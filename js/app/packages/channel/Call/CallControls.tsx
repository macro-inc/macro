import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import {
  DropdownMenuContent,
  MENU_ITEM_CLASS,
} from '@core/component/Menu';
import CheckIcon from '@icon/bold/check-bold.svg';
import Microphone from '@icon/regular/microphone.svg';
import MicrophoneSlash from '@icon/regular/microphone-slash.svg';
import Screencast from '@icon/regular/screencast.svg';
import PhoneDisconnect from '@icon/regular/phone-disconnect.svg';
import VideoCamera from '@icon/regular/video-camera.svg';
import VideoCameraSlash from '@icon/regular/video-camera-slash.svg';
import VideoConference from '@icon/regular/video-conference.svg';
import { For, Show, type Accessor } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { CallControlVariant } from './CallControlButton';
import { CallControlButton } from './CallControlButton';
import { CallControlButtonWithDropdown } from './CallControlButtonWithDropdown';
import { CallDeviceList } from './CallDeviceList';
import { useCallContext } from './CallContext';

export type CallControlsProps = {
  /** Leave / hang up — parent supplies tab switch, `leaveCall()`, etc. */
  onLeave: () => void | Promise<void>;
  variant?: CallControlVariant;
  when?: boolean | Accessor<boolean>;
  class?: string;
};

function readWhen(
  when: boolean | Accessor<boolean> | undefined
): boolean {
  if (when === undefined) return true;
  return typeof when === 'function' ? when() : when;
}

const menuItemClass = cn(
  MENU_ITEM_CLASS,
  'cursor-pointer hover:bg-hover hover-transition-bg'
);

const menuGroupLabelClass = `${MENU_ITEM_CLASS} text-xs! text-ink-extra-muted`;

const leaveItemClass = cn(
  MENU_ITEM_CLASS,
  'cursor-pointer text-failure hover:bg-failure/10 hover-transition-bg'
);

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
    resolvedVariant === 'panel' || resolvedVariant === 'panel-small'
      ? 'w-4 h-4'
      : 'w-5 h-5';

  const isPanelLike = resolvedVariant === 'panel';

  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();

  const defaultAndPanelRow = (
    <div
      data-call-controls
      class={cn(
        'flex flex-row flex-wrap items-center',
        resolvedVariant === 'default' && 'justify-center gap-3',
        isPanelLike &&
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
  );

  return (
    <Show when={() => readWhen(whenProp)}>
      <Show
        when={resolvedVariant === 'panel-small'}
        fallback={defaultAndPanelRow}
      >
        <div
          data-call-controls
          data-call-controls-panel-small
          class={cn(
            'flex flex-row flex-wrap items-center justify-center gap-0.5',
            className
          )}
        >
          <DropdownMenu placement="top-start" gutter={4}>
            <DropdownMenu.Trigger
              as="button"
              type="button"
              disabled={isConnecting()}
              class={cn(
                'flex items-center justify-center w-8 h-8 shrink-0 rounded-md border-0 bg-transparent transition-colors',
                isConnecting() &&
                  'opacity-50 pointer-events-none cursor-not-allowed',
                !isConnecting() &&
                  (!callCtx.isAudioMuted() ||
                    !callCtx.isVideoMuted() ||
                    callCtx.isScreenSharing())
                  ? 'text-accent-2'
                  : 'text-ink',
                !isConnecting() && 'hover:bg-ink/5 cursor-pointer'
              )}
              aria-label="Call options"
            >
              <VideoConference class={iconClass} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenuContent class="mb-2 z-modal" width="lg">
                <DropdownMenu.Item
                  class={menuItemClass}
                  onSelect={() => void callCtx.toggleAudio()}
                >
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    <Show
                      when={!callCtx.isAudioMuted()}
                      fallback={<MicrophoneSlash class="h-4 w-4 shrink-0" />}
                    >
                      <Microphone class="h-4 w-4 shrink-0" />
                    </Show>
                    <span class="truncate">
                      {callCtx.isAudioMuted()
                        ? 'Unmute microphone'
                        : 'Mute microphone'}
                    </span>
                  </div>
                </DropdownMenu.Item>

                <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel class={menuGroupLabelClass}>
                    Microphone
                  </DropdownMenu.GroupLabel>
                  <For each={callCtx.audioInputDevices()}>
                    {(device) => (
                      <DropdownMenu.Item
                        class={menuItemClass}
                        onSelect={() => void callCtx.switchAudioInput(device.deviceId)}
                      >
                        <div class="flex min-w-0 flex-1 items-center gap-2">
                          <span class="flex-1 truncate">{device.label}</span>
                          <Show
                            when={
                              callCtx.activeAudioInputDeviceId() ===
                              device.deviceId
                            }
                          >
                            <CheckIcon class="h-3 w-3 shrink-0 text-accent" />
                          </Show>
                        </div>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Group>

                <Show when={callCtx.audioOutputDevices().length > 0}>
                  <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />
                  <DropdownMenu.Group>
                    <DropdownMenu.GroupLabel class={menuGroupLabelClass}>
                      Speaker
                    </DropdownMenu.GroupLabel>
                    <For each={callCtx.audioOutputDevices()}>
                      {(device) => (
                        <DropdownMenu.Item
                          class={menuItemClass}
                          onSelect={() =>
                            void callCtx.switchAudioOutput(device.deviceId)
                          }
                        >
                          <div class="flex min-w-0 flex-1 items-center gap-2">
                            <span class="flex-1 truncate">{device.label}</span>
                            <Show
                              when={
                                callCtx.activeAudioOutputDeviceId() ===
                                device.deviceId
                              }
                            >
                              <CheckIcon class="h-3 w-3 shrink-0 text-accent" />
                            </Show>
                          </div>
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.Group>
                </Show>

                <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

                <DropdownMenu.Item
                  class={menuItemClass}
                  onSelect={() => void callCtx.toggleVideo()}
                >
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    <Show
                      when={!callCtx.isVideoMuted()}
                      fallback={<VideoCameraSlash class="h-4 w-4 shrink-0" />}
                    >
                      <VideoCamera class="h-4 w-4 shrink-0" />
                    </Show>
                    <span class="truncate">
                      {callCtx.isVideoMuted()
                        ? 'Turn camera on'
                        : 'Turn camera off'}
                    </span>
                  </div>
                </DropdownMenu.Item>

                <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel class={menuGroupLabelClass}>
                    Camera
                  </DropdownMenu.GroupLabel>
                  <For each={callCtx.videoInputDevices()}>
                    {(device) => (
                      <DropdownMenu.Item
                        class={menuItemClass}
                        onSelect={() => void callCtx.switchVideoInput(device.deviceId)}
                      >
                        <div class="flex min-w-0 flex-1 items-center gap-2">
                          <span class="flex-1 truncate">{device.label}</span>
                          <Show
                            when={
                              callCtx.activeVideoInputDeviceId() ===
                              device.deviceId
                            }
                          >
                            <CheckIcon class="h-3 w-3 shrink-0 text-accent" />
                          </Show>
                        </div>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Group>

                <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

                <DropdownMenu.Item
                  class={menuItemClass}
                  onSelect={() => void callCtx.toggleScreenShare()}
                >
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    <Screencast class="h-4 w-4 shrink-0" />
                    <span class="truncate">
                      {callCtx.isScreenSharing()
                        ? 'Stop sharing screen'
                        : 'Share screen'}
                    </span>
                  </div>
                </DropdownMenu.Item>

                <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

                <DropdownMenu.Item
                  class={leaveItemClass}
                  onSelect={() => void onLeave()}
                >
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    <PhoneDisconnect class="h-4 w-4 shrink-0" />
                    <span class="truncate">Leave call</span>
                  </div>
                </DropdownMenu.Item>
              </DropdownMenuContent>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
      </Show>
    </Show>
  );
}
