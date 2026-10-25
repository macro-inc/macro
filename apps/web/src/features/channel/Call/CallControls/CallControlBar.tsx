import CaretUp from '@phosphor/caret-up.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import PhoneDisconnect from '@phosphor/phone-disconnect.svg';
import Screencast from '@phosphor/screencast.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import { Button, ButtonGroup, Dropdown } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

/**
 * A media toggle split from its settings menu: the left half turns the device
 * on or off, the caret opens its menu on click.
 */
function MediaSplitButton(props: {
  label: string;
  toggleLabel: string;
  menuLabel: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  icon: JSX.Element;
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Dropdown placement="top-start" open={open()} onOpenChange={setOpen}>
      <ButtonGroup size="icon-lg" label={props.label}>
        <Button
          label={props.toggleLabel}
          tooltipPlacement="top"
          aria-pressed={props.on}
          disabled={props.disabled}
          onClick={props.onToggle}
        >
          {props.icon}
        </Button>
        <ButtonGroup.Divider />
        <Dropdown.Trigger
          variant="ghost"
          size="icon-lg"
          label={props.menuLabel}
          tooltipPlacement="top"
          tooltipDisabled={open()}
          class="w-6"
        >
          <CaretUp
            class="size-3 transition-transform duration-200 ease-out motion-reduce:transition-none"
            classList={{ 'rotate-180': open() }}
          />
        </Dropdown.Trigger>
      </ButtonGroup>
      <Dropdown.Content class="w-72 max-w-[calc(100vw-2rem)]">
        {props.children}
      </Dropdown.Content>
    </Dropdown>
  );
}

export function CallControlBar(props: {
  disabled: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  screenSharing: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
  /** Dropdown items for microphone, speaker, and audio processing. */
  audioMenu: JSX.Element;
  /** Dropdown items for the camera and its background effect. */
  videoMenu: JSX.Element;
  error?: string;
}) {
  return (
    <div data-call-controls class="@container relative z-20 w-full max-w-xl">
      <div class="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-xl bg-menu-glass p-1.5 text-ink glass @sm:gap-2">
        <MediaSplitButton
          label="Microphone"
          toggleLabel={
            props.audioMuted ? 'Unmute microphone' : 'Mute microphone'
          }
          menuLabel="Audio settings"
          on={!props.audioMuted}
          disabled={props.disabled}
          onToggle={props.onToggleAudio}
          icon={
            <Show when={props.audioMuted} fallback={<Microphone />}>
              <MicrophoneSlash />
            </Show>
          }
        >
          {props.audioMenu}
        </MediaSplitButton>
        <MediaSplitButton
          label="Camera"
          toggleLabel={props.videoMuted ? 'Turn on camera' : 'Turn off camera'}
          menuLabel="Video settings"
          on={!props.videoMuted}
          disabled={props.disabled}
          onToggle={props.onToggleVideo}
          icon={
            <Show when={props.videoMuted} fallback={<VideoCamera />}>
              <VideoCameraSlash />
            </Show>
          }
        >
          {props.videoMenu}
        </MediaSplitButton>
        <Button
          size="icon-lg"
          variant="outline"
          label={props.screenSharing ? 'Stop sharing screen' : 'Share screen'}
          tooltipPlacement="top"
          aria-pressed={props.screenSharing}
          disabled={props.disabled}
          onClick={props.onToggleScreen}
        >
          <Screencast />
        </Button>
        <Button
          size="icon-lg"
          variant="danger"
          label="Leave call"
          tooltipPlacement="top"
          onClick={props.onLeave}
        >
          <PhoneDisconnect />
        </Button>
      </div>
      <Show when={props.error}>
        <p
          role="alert"
          class="absolute inset-x-0 top-full rounded-lg bg-panel p-2 text-center text-xs text-failure"
        >
          {props.error}
        </p>
      </Show>
    </div>
  );
}
