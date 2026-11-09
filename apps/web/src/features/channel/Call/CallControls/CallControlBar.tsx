import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import CaretUp from '@icon/system/regular/caret-up.svg';
import ExclamationMark from '@icon/system/regular/exclamation-mark.svg';
import Microphone from '@icon/system/regular/microphone.svg';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import PhoneDisconnect from '@icon/system/regular/phone-disconnect.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import VideoCamera from '@icon/system/regular/video-camera.svg';
import VideoCameraSlash from '@icon/system/regular/video-camera-slash.svg';
import { Button, ButtonGroup, cn } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { CallSettingsMenu } from './CallSettingsMenu';

export function callMediaButtonVariant(off: boolean, disabled: boolean) {
  return off && !disabled ? 'danger' : 'secondary';
}

export function BlockedMediaBadge(props: { blocked: boolean }) {
  return (
    <Show when={props.blocked}>
      <span
        aria-hidden="true"
        data-call-permission-badge
        class="absolute top-1 right-1 z-10 grid size-4 place-items-center rounded-full bg-surface-2 text-warning-ink"
      >
        <span class="grid size-full place-items-center rounded-full bg-warning-bg">
          <ExclamationMark class="size-3" />
        </span>
      </span>
    </Show>
  );
}
/**
 * A media toggle split from its settings menu: the left half turns the device
 * on or off, the caret opens its menu on click. The toggle keeps one fill and
 * shows its state through the icon, with failure color when the device is off.
 */
function MediaSplitButton(props: {
  label: string;
  toggleLabel: string;
  tooltipLabel?: string;
  shortcut?: string;
  menuLabel: string;
  disabled?: boolean;
  compact?: boolean;
  off?: boolean;
  blocked?: boolean;
  /** Set for a toggle whose icon stays the same in both states. */
  pressed?: boolean;
  onToggle: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  icon: JSX.Element;
  children: JSX.Element;
  mobileContent: JSX.Element;
  hideMenu?: boolean;
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
        <div class="relative shrink-0">
          <ButtonGroup
            variant={callMediaButtonVariant(
              !!props.off,
              !!props.disabled || !!props.blocked
            )}
            size={props.compact ? 'icon-md' : 'icon-lg'}
            aria-label={props.label}
            class="shrink-0"
          >
            <ButtonGroup.Button
              aria-label={props.toggleLabel}
              variant={
                props.pressed
                  ? 'accent'
                  : callMediaButtonVariant(
                      !!props.off,
                      !!props.disabled || !!props.blocked
                    )
              }
              tooltip={{
                content: (
                  <span class="whitespace-nowrap">
                    {props.tooltipLabel ?? props.toggleLabel}
                  </span>
                ),
                placement: 'top',
                shortcut: props.shortcut,
              }}
              aria-pressed={props.pressed}
              disabled={props.disabled}
              onClick={props.onToggle}
            >
              {props.icon}
              <BlockedMediaBadge blocked={!!props.blocked} />
            </ButtonGroup.Button>
            <Show when={!isMobile() && !props.hideMenu}>
              <ButtonGroup.Divider />
              <ButtonGroup.Button
                {...triggerProps}
                disabled={props.disabled}
                variant={callMediaButtonVariant(
                  !!props.off,
                  !!props.disabled || !!props.blocked
                )}
                size={props.compact ? 'icon-md' : 'icon-lg'}
                aria-label={props.menuLabel}
                tooltip={{
                  content: props.menuLabel,
                  placement: 'top',
                  disabled: open(),
                }}
                class={props.compact ? 'w-4' : 'w-6'}
              >
                <CaretUp
                  class="size-3 transition-transform duration-200 ease-out motion-reduce:transition-none"
                  classList={{ 'rotate-180': open() }}
                />
              </ButtonGroup.Button>
            </Show>
          </ButtonGroup>
        </div>
      )}
    >
      {props.children}
    </CallSettingsMenu>
  );
}

export function CallControlBar(props: {
  disabled: boolean;
  compact?: boolean;
  unframed?: boolean;
  smallIcons?: boolean;
  showShortcuts?: boolean;
  canLeave?: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  audioPermission?: PermissionState;
  videoPermission?: PermissionState;
  screenSharing: boolean;
  screenUnavailable?: boolean;
  onToggleAudio: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  onToggleVideo: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
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
  const iconClass = () => (props.smallIcons ? 'size-3.5' : 'size-5');
  let audioOpen = false;
  let videoOpen = false;
  let screenOpen = false;
  return (
    <div
      data-call-controls
      class={cn(
        'relative z-20 max-w-full',
        props.unframed ? 'w-full' : 'w-fit'
      )}
    >
      <div
        class={cn(
          !props.unframed && (isMobile() ? 'island' : 'menu-surface'),
          'mx-auto flex w-fit max-w-full items-center justify-center text-ink',
          props.unframed
            ? 'flex-wrap gap-2 py-2'
            : cn('gap-2 rounded-full', isMobile() ? 'p-1.5' : 'p-2')
        )}
      >
        <MediaSplitButton
          label="Microphone"
          off={props.audioMuted}
          blocked={props.audioPermission === 'denied'}
          shortcut={props.showShortcuts && !isMobile() ? 'cmd+d' : undefined}
          compact={props.compact}
          onOpenChange={(open) => {
            audioOpen = open;
            props.onSettingsOpenChange?.(audioOpen || videoOpen || screenOpen);
          }}
          toggleLabel={
            props.audioPermission === 'denied'
              ? t('calls.microphoneBlocked')
              : props.audioMuted
                ? 'Unmute microphone'
                : 'Mute microphone'
          }
          tooltipLabel={
            props.audioPermission === 'denied'
              ? t('calls.microphoneBlockedTooltip')
              : undefined
          }
          menuLabel="Audio settings"
          mobileContent={props.audioDrawer}
          disabled={props.disabled}
          onToggle={props.onToggleAudio}
          icon={
            <Show
              when={props.audioMuted || props.audioPermission === 'denied'}
              fallback={<Microphone class={iconClass()} />}
            >
              <MicrophoneSlash
                class={cn(
                  iconClass(),
                  props.audioPermission === 'denied' && 'text-ink-subtle'
                )}
              />
            </Show>
          }
        >
          {props.audioMenu}
        </MediaSplitButton>
        <MediaSplitButton
          label="Camera"
          off={props.videoMuted}
          blocked={props.videoPermission === 'denied'}
          shortcut={
            props.showShortcuts && !isMobile() ? 'shift+cmd+e' : undefined
          }
          compact={props.compact}
          onOpenChange={(open) => {
            videoOpen = open;
            props.onSettingsOpenChange?.(audioOpen || videoOpen || screenOpen);
          }}
          toggleLabel={
            props.videoPermission === 'denied'
              ? t('calls.cameraBlocked')
              : props.videoMuted
                ? 'Turn on camera'
                : 'Turn off camera'
          }
          mobileContent={props.videoDrawer}
          tooltipLabel={
            props.videoPermission === 'denied'
              ? t('calls.cameraBlockedTooltip')
              : undefined
          }
          menuLabel="Video settings"
          disabled={props.disabled}
          onToggle={props.onToggleVideo}
          icon={
            <Show
              when={props.videoMuted || props.videoPermission === 'denied'}
              fallback={<VideoCamera class={iconClass()} />}
            >
              <VideoCameraSlash
                class={cn(
                  iconClass(),
                  props.videoPermission === 'denied' && 'text-ink-subtle'
                )}
              />
            </Show>
          }
        >
          {props.videoMenu}
        </MediaSplitButton>
        <Show when={!isMobile()}>
          <MediaSplitButton
            label="Screen share"
            compact={props.compact}
            hideMenu={props.compact && !props.unframed}
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
            icon={<Screencast class={iconClass()} />}
          >
            {props.screenMenu}
          </MediaSplitButton>
        </Show>
        {props.children}
        <Show when={props.canLeave !== false}>
          <Button
            size={props.compact ? 'icon-md' : 'icon-lg'}
            variant="danger"
            aria-label="Leave call"
            class={cn(
              'rounded-full',
              !props.unframed && (props.compact ? 'min-w-11' : 'min-w-14')
            )}
            tooltip={{ content: 'Leave call', placement: 'top' }}
            onClick={props.onLeave}
          >
            <PhoneDisconnect class={iconClass()} />
          </Button>
        </Show>
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
