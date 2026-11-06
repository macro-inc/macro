import { isMobile } from '@core/mobile/isMobile';
import CaretUp from '@icon/system/regular/caret-up.svg';
import Microphone from '@icon/system/regular/microphone.svg';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import PhoneDisconnect from '@icon/system/regular/phone-disconnect.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import VideoCamera from '@icon/system/regular/video-camera.svg';
import VideoCameraSlash from '@icon/system/regular/video-camera-slash.svg';
import { Button, ButtonGroup, cn } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { CallSettingsMenu } from './CallSettingsMenu';

/**
 * A media toggle split from its settings menu: the left half turns the device
 * on or off, the caret opens its menu on click. The toggle keeps one fill and
 * shows its state through the icon, with failure color when the device is off.
 */
function MediaSplitButton(props: {
  label: string;
  toggleLabel: string;
  menuLabel: string;
  disabled?: boolean;
  compact?: boolean;
  /** Set for a toggle whose icon stays the same in both states. */
  pressed?: boolean;
  onToggle: () => void;
  icon: JSX.Element;
  children: JSX.Element;
  mobileContent: JSX.Element;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <CallSettingsMenu
      title={props.menuLabel}
      open={open()}
      onOpenChange={(open) => {
        setOpen(open);
        props.onOpenChange?.(open);
      }}
      mobileContent={props.mobileContent}
      trigger={(triggerProps) => (
        <ButtonGroup
          size={props.compact ? 'icon-md' : 'icon-lg'}
          aria-label={props.label}
          class="shrink-0"
        >
          <ButtonGroup.Button
            aria-label={props.toggleLabel}
            variant={props.pressed ? 'accent' : 'secondary'}
            tooltip={{ content: props.toggleLabel, placement: 'top' }}
            aria-pressed={props.pressed}
            disabled={props.disabled}
            onClick={props.onToggle}
          >
            {props.icon}
          </ButtonGroup.Button>
          <Show when={!isMobile()}>
            <ButtonGroup.Divider />
            <ButtonGroup.Button
              {...triggerProps}
              disabled={props.disabled}
              variant="ghost"
              size={props.compact ? 'icon-md' : 'icon-lg'}
              aria-label={props.menuLabel}
              tooltip={{
                content: props.menuLabel,
                placement: 'top',
                disabled: open(),
              }}
              class="w-6 mobile:@max-[20rem]:min-w-6"
            >
              <CaretUp
                class="size-3 transition-transform duration-200 ease-out motion-reduce:transition-none"
                classList={{ 'rotate-180': open() }}
              />
            </ButtonGroup.Button>
          </Show>
        </ButtonGroup>
      )}
    >
      {props.children}
    </CallSettingsMenu>
  );
}

export function CallControlBar(props: {
  disabled: boolean;
  compact?: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  screenSharing: boolean;
  screenUnavailable?: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
  /** Dropdown items for microphone, speaker, and audio processing. */
  audioMenu: JSX.Element;
  /** Dropdown items for the camera and its background effect. */
  videoMenu: JSX.Element;
  audioDrawer: JSX.Element;
  videoDrawer: JSX.Element;
  /** Dropdown items for what a screen share captures. */
  screenMenu: JSX.Element;
  screenDrawer: JSX.Element;
  error?: string;
  onSettingsOpenChange?: (open: boolean) => void;
  children?: JSX.Element;
}) {
  let audioOpen = false;
  let videoOpen = false;
  let screenOpen = false;
  return (
    <div data-call-controls class="@container relative z-20 w-fit max-w-full">
      <div
        class={cn(
          isMobile() ? 'island' : 'menu-surface',
          'mx-auto flex w-fit max-w-full items-center justify-center gap-2 rounded-full p-1.5 text-ink'
        )}
      >
        <MediaSplitButton
          label="Microphone"
          compact={props.compact}
          onOpenChange={(open) => {
            audioOpen = open;
            props.onSettingsOpenChange?.(audioOpen || videoOpen || screenOpen);
          }}
          toggleLabel={
            props.audioMuted ? 'Unmute microphone' : 'Mute microphone'
          }
          menuLabel="Audio settings"
          mobileContent={props.audioDrawer}
          disabled={props.disabled}
          onToggle={props.onToggleAudio}
          icon={
            <Show
              when={props.audioMuted}
              fallback={<Microphone class="size-5" />}
            >
              <MicrophoneSlash class="size-5 text-failure" />
            </Show>
          }
        >
          {props.audioMenu}
        </MediaSplitButton>
        <MediaSplitButton
          label="Camera"
          compact={props.compact}
          onOpenChange={(open) => {
            videoOpen = open;
            props.onSettingsOpenChange?.(audioOpen || videoOpen || screenOpen);
          }}
          toggleLabel={props.videoMuted ? 'Turn on camera' : 'Turn off camera'}
          mobileContent={props.videoDrawer}
          menuLabel="Video settings"
          disabled={props.disabled}
          onToggle={props.onToggleVideo}
          icon={
            <Show
              when={props.videoMuted}
              fallback={<VideoCamera class="size-5" />}
            >
              <VideoCameraSlash class="size-5 text-failure" />
            </Show>
          }
        >
          {props.videoMenu}
        </MediaSplitButton>
        <Show when={!isMobile()}>
          <MediaSplitButton
            label="Screen share"
            compact={props.compact}
            onOpenChange={(open) => {
              screenOpen = open;
              props.onSettingsOpenChange?.(
                audioOpen || videoOpen || screenOpen
              );
            }}
            mobileContent={props.screenDrawer}
            toggleLabel={
              props.screenSharing ? 'Stop sharing screen' : 'Share screen'
            }
            menuLabel="Screen share settings"
            pressed={props.screenSharing}
            disabled={props.disabled || props.screenUnavailable}
            onToggle={props.onToggleScreen}
            icon={<Screencast class="size-5" />}
          >
            {props.screenMenu}
          </MediaSplitButton>
        </Show>
        {props.children}
        <Button
          size={props.compact ? 'icon-md' : 'icon-lg'}
          variant="danger"
          aria-label="Leave call"
          class="min-w-14 rounded-full"
          tooltip={{ content: 'Leave call', placement: 'top' }}
          onClick={props.onLeave}
        >
          <PhoneDisconnect class="size-5" />
        </Button>
      </div>
      <Show when={props.error}>
        <p
          role="alert"
          class="absolute inset-x-0 top-full rounded-lg bg-panel p-2 text-center text-xs text-failure mobile:top-auto mobile:bottom-full mobile:mb-2"
        >
          {props.error}
        </p>
      </Show>
    </div>
  );
}
