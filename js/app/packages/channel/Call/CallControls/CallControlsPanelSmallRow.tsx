import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { DropdownMenuContent, MENU_ITEM_CLASS } from '@core/component/Menu';
import CheckIcon from '@icon/bold/check-bold.svg';
import Microphone from '@icon/regular/microphone.svg';
import MicrophoneSlash from '@icon/regular/microphone-slash.svg';
import Screencast from '@icon/regular/screencast.svg';
import PhoneDisconnect from '@macro-icons/wide/call-disconnect.svg';
import Users from '@icon/regular/users.svg';
import VideoCamera from '@icon/regular/video-camera.svg';
import VideoCameraSlash from '@icon/regular/video-camera-slash.svg';
import VideoConference from '@icon/regular/video-conference.svg';
import { useToggleShareWithTeamMutation } from '@queries/call/call';
import { For, Show } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useCallContext } from '../CallContext';

const menuStyles = {
  item: cn(
    MENU_ITEM_CLASS,
    'cursor-pointer hover:bg-hover hover-transition-bg'
  ),
  groupLabel: cn(MENU_ITEM_CLASS, 'text-xs text-accent'),
};

const panelSmallIconClass = 'w-4 h-4';

export type CallControlsPanelSmallRowProps = {
  class?: string;
  onLeave: () => void | Promise<void>;
};

export function CallControlsPanelSmallRow(
  props: CallControlsPanelSmallRowProps
) {
  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();
  const toggleShareWithTeam = useToggleShareWithTeamMutation();

  const handleToggleShareWithTeam = async () => {
    const callId = callCtx.activeCallId();
    if (!callId) return;
    const newValue = await toggleShareWithTeam.mutateAsync(callId);
    callCtx.setSharedWithTeam(newValue);
  };

  return (
    <div
      data-call-controls
      data-call-controls-panel-small
      class={cn(
        'flex flex-row flex-wrap items-center justify-center gap-0.5',
        props.class
      )}
    >
      <DropdownMenu placement="top-start" gutter={4}>
        <DropdownMenu.Trigger
          as="button"
          type="button"
          disabled={isConnecting()}
          class={cn(
            'flex items-center justify-center w-4 h-4 shrink-0 rounded-md border-0 bg-transparent transition-colors',
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
          <VideoConference class={panelSmallIconClass} />
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenuContent class="mb-2 z-modal" width="lg">
            <DropdownMenu.Item
              class={menuStyles.item}
              closeOnSelect={false}
              onSelect={() => void callCtx.toggleAudio()}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <Show
                  when={!callCtx.isAudioMuted()}
                  fallback={<MicrophoneSlash class="h-4 w-4 shrink-0" />}
                >
                  <Microphone class="h-4 w-4 shrink-0" />
                </Show>
                <span class="min-w-0 flex-1">
                  {callCtx.isAudioMuted()
                    ? 'Unmute microphone'
                    : 'Mute microphone'}
                </span>
              </div>
            </DropdownMenu.Item>

            <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel class={menuStyles.groupLabel}>
                Microphone
              </DropdownMenu.GroupLabel>

              <For each={callCtx.audioInputDevices()}>
                {(device) => (
                  <DropdownMenu.Item
                    class={menuStyles.item}
                    closeOnSelect={false}
                    onSelect={() =>
                      void callCtx.switchAudioInput(device.deviceId)
                    }
                  >
                    <div class="flex min-w-0 flex-1 items-baseline gap-2">
                      <span class="min-w-0 flex-1">{device.label}</span>
                      <span class="inline-flex w-3 shrink-0 justify-center">
                        <Show
                          when={
                            callCtx.activeAudioInputDeviceId() ===
                            device.deviceId
                          }
                        >
                          <CheckIcon class="h-3 w-3 text-accent" />
                        </Show>
                      </span>
                    </div>
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Group>

            <Show when={callCtx.audioOutputDevices().length > 0}>
              <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />
              <DropdownMenu.Group>
                <DropdownMenu.GroupLabel class={menuStyles.groupLabel}>
                  Speaker
                </DropdownMenu.GroupLabel>
                <For each={callCtx.audioOutputDevices()}>
                  {(device) => (
                    <DropdownMenu.Item
                      class={menuStyles.item}
                      closeOnSelect={false}
                      onSelect={() =>
                        void callCtx.switchAudioOutput(device.deviceId)
                      }
                    >
                      <div class="flex min-w-0 flex-1 items-baseline gap-2">
                        <span class="min-w-0 flex-1">{device.label}</span>
                        <span class="inline-flex w-3 shrink-0 justify-center">
                          <Show
                            when={
                              callCtx.activeAudioOutputDeviceId() ===
                              device.deviceId
                            }
                          >
                            <CheckIcon class="h-3 w-3 text-accent" />
                          </Show>
                        </span>
                      </div>
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.Group>
            </Show>

            <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

            <DropdownMenu.Item
              class={menuStyles.item}
              closeOnSelect={false}
              onSelect={() => void callCtx.toggleVideo()}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <Show
                  when={!callCtx.isVideoMuted()}
                  fallback={<VideoCameraSlash class="h-4 w-4 shrink-0" />}
                >
                  <VideoCamera class="h-4 w-4 shrink-0" />
                </Show>
                <span class="min-w-0 flex-1">
                  {callCtx.isVideoMuted()
                    ? 'Turn camera on'
                    : 'Turn camera off'}
                </span>
              </div>
            </DropdownMenu.Item>

            <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

            <DropdownMenu.Group class="w-full">
              <DropdownMenu.GroupLabel class={menuStyles.groupLabel}>
                Camera
              </DropdownMenu.GroupLabel>
              <For each={callCtx.videoInputDevices()}>
                {(device) => (
                  <DropdownMenu.Item
                    class={menuStyles.item}
                    closeOnSelect={false}
                    onSelect={() =>
                      void callCtx.switchVideoInput(device.deviceId)
                    }
                  >
                    <div class="flex min-w-0 flex-1 items-baseline gap-2">
                      <span class="min-w-0 flex-1">{device.label}</span>
                      <span class="inline-flex w-3 shrink-0 justify-center">
                        <Show
                          when={
                            callCtx.activeVideoInputDeviceId() ===
                            device.deviceId
                          }
                        >
                          <CheckIcon class="h-3 w-3 text-accent" />
                        </Show>
                      </span>
                    </div>
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Group>

            <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

            <DropdownMenu.Item
              class={menuStyles.item}
              closeOnSelect={false}
              onSelect={() => void callCtx.toggleScreenShare()}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <Screencast class="h-4 w-4 shrink-0" />
                <span class="min-w-0 flex-1">
                  {callCtx.isScreenSharing()
                    ? 'Stop sharing screen'
                    : 'Share screen'}
                </span>
              </div>
            </DropdownMenu.Item>

            <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

            <DropdownMenu.Item
              class={menuStyles.item}
              closeOnSelect={false}
              onSelect={() => void handleToggleShareWithTeam()}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <Users class="h-4 w-4 shrink-0" />
                <span class="min-w-0 flex-1">
                  {callCtx.isSharedWithTeam()
                    ? 'Shared with team'
                    : 'Share with team'}
                </span>
              </div>
            </DropdownMenu.Item>

            <DropdownMenu.Separator class="my-1 w-full border-t border-edge" />

            <DropdownMenu.Item
              class={cn(
                MENU_ITEM_CLASS,
                'cursor-pointer text-failure hover:bg-failure/10 hover-transition-bg'
              )}
              onSelect={() => void props.onLeave()}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <PhoneDisconnect class="h-4 w-4 shrink-0" />
                <span class="min-w-0 flex-1">Leave call</span>
              </div>
            </DropdownMenu.Item>
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
}
