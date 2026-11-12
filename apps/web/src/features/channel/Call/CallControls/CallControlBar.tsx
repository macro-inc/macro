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
import {
  createContext,
  createSignal,
  type JSX,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { CallSettingsMenu } from './CallSettingsMenu';

export function callMediaButtonVariant(off: boolean, disabled: boolean) {
  return off && !disabled ? 'danger' : 'secondary';
}

export function BlockedMediaBadge(props: { blocked: boolean; class?: string }) {
  return (
    <Show when={props.blocked}>
      <span
        aria-hidden="true"
        data-call-permission-badge
        class={cn(
          'pointer-events-none absolute top-1 right-0 z-10 grid size-4 place-items-center rounded-full bg-surface-2 text-warning-ink',
          props.class
        )}
      >
        <span class="grid size-full place-items-center rounded-full bg-warning-bg">
          <ExclamationMark class="size-3" />
        </span>
      </span>
    </Show>
  );
}

type BarProps = ParentProps<{
  compact?: boolean;
  unframed?: boolean;
  smallIcons?: boolean;
  showShortcuts?: boolean;
  disabled?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
}>;
type BarContext = {
  props: BarProps;
  menuChanged: (device: string, open: boolean) => void;
  iconClass: () => string;
};
const ControlBarContext = createContext<BarContext>();
function useControlBar() {
  const context = useContext(ControlBarContext);
  if (!context)
    throw new Error('Call control parts require CallControlBar.Root');
  return context;
}

function Root(props: BarProps) {
  const openMenus = new Set<string>();
  const menuChanged = (device: string, open: boolean) => {
    if (open) openMenus.add(device);
    else openMenus.delete(device);
    props.onSettingsOpenChange?.(openMenus.size > 0);
  };
  const frameClass = () => {
    if (props.unframed) return 'flex-wrap gap-2 py-2';
    return cn(
      'gap-2 rounded-full',
      isMobile() ? 'island p-1.5' : 'menu-surface p-2'
    );
  };
  return (
    <ControlBarContext.Provider
      value={{
        props,
        menuChanged,
        iconClass: () => (props.smallIcons ? 'size-3.5' : 'size-5'),
      }}
    >
      <div
        data-call-controls
        class={cn(
          'relative z-20 max-w-full',
          props.unframed ? 'w-full' : 'w-fit'
        )}
      >
        <div
          class={cn(
            'mx-auto flex w-fit max-w-full items-center justify-center text-ink',
            frameClass()
          )}
        >
          {props.children}
        </div>
      </div>
    </ControlBarContext.Provider>
  );
}

type MediaToggleProps = {
  muted: boolean;
  permission?: PermissionState;
  onToggle: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  children: JSX.Element;
  mobileContent: JSX.Element;
};
type SplitProps = {
  device: string;
  label: string;
  toggleLabel: string;
  tooltipLabel?: string;
  shortcut?: string;
  menuLabel: string;
  disabled?: boolean;
  off?: boolean;
  blocked?: boolean;
  pressed?: boolean;
  onToggle: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  icon: JSX.Element;
  children: JSX.Element;
  mobileContent: JSX.Element;
  hideMenu?: boolean;
};

function MediaSplitButton(props: SplitProps) {
  const bar = useControlBar();
  const [open, setOpen] = createSignal(false);
  const variant = () =>
    callMediaButtonVariant(!!props.off, !!props.disabled || !!props.blocked);
  const toggleVariant = () => (props.pressed ? 'accent' : variant());
  const showMenu = () => !isMobile() && !props.hideMenu;
  return (
    <CallSettingsMenu
      title={props.menuLabel}
      open={open()}
      onOpenChange={(value) => {
        setOpen(value);
        bar.menuChanged(props.device, value);
      }}
      mobileContent={props.mobileContent}
      trigger={(triggerProps) => (
        <div class="relative shrink-0">
          <ButtonGroup
            variant={variant()}
            size={bar.props.compact ? 'icon-md' : 'icon-lg'}
            aria-label={props.label}
            class="shrink-0"
          >
            <ButtonGroup.Button
              aria-label={props.toggleLabel}
              variant={toggleVariant()}
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
            </ButtonGroup.Button>
            <Show when={showMenu()}>
              <ButtonGroup.Divider />
              <ButtonGroup.Button
                {...triggerProps}
                disabled={props.disabled}
                variant={variant()}
                size={bar.props.compact ? 'icon-md' : 'icon-lg'}
                aria-label={props.menuLabel}
                tooltip={{
                  content: props.menuLabel,
                  placement: 'top',
                  disabled: open(),
                }}
                class={bar.props.compact ? 'w-4' : 'w-6'}
              >
                <CaretUp
                  class="size-3 transition-transform duration-200 ease-out motion-reduce:transition-none"
                  classList={{ 'rotate-180': open() }}
                />
              </ButtonGroup.Button>
            </Show>
          </ButtonGroup>
          <BlockedMediaBadge
            blocked={!!props.blocked}
            class={cn(
              showMenu() && '-top-1',
              showMenu() && (bar.props.compact ? '-right-0.75' : 'right-px')
            )}
          />
        </div>
      )}
    >
      {props.children}
    </CallSettingsMenu>
  );
}

function MicrophoneControl(props: MediaToggleProps) {
  const bar = useControlBar();
  const blocked = () => props.permission === 'denied';
  const label = () => {
    if (blocked()) return t('calls.microphoneBlocked');
    return props.muted
      ? t('calls.unmuteMicrophone')
      : t('calls.muteMicrophone');
  };
  return (
    <MediaSplitButton
      device="microphone"
      label="Microphone"
      off={props.muted}
      blocked={blocked()}
      shortcut={bar.props.showShortcuts && !isMobile() ? 'cmd+d' : undefined}
      toggleLabel={label()}
      tooltipLabel={blocked() ? t('calls.microphoneBlockedTooltip') : undefined}
      menuLabel="Audio settings"
      mobileContent={props.mobileContent}
      disabled={bar.props.disabled}
      onToggle={props.onToggle}
      icon={
        <Show
          when={props.muted || blocked()}
          fallback={<Microphone class={bar.iconClass()} />}
        >
          <MicrophoneSlash
            class={cn(bar.iconClass(), blocked() && 'text-ink-subtle')}
          />
        </Show>
      }
    >
      {props.children}
    </MediaSplitButton>
  );
}

function CameraControl(props: MediaToggleProps) {
  const bar = useControlBar();
  const blocked = () => props.permission === 'denied';
  const label = () => {
    if (blocked()) return t('calls.cameraBlocked');
    return props.muted ? t('calls.turnOnCamera') : t('calls.turnOffCamera');
  };
  return (
    <MediaSplitButton
      device="camera"
      label="Camera"
      off={props.muted}
      blocked={blocked()}
      shortcut={
        bar.props.showShortcuts && !isMobile() ? 'shift+cmd+e' : undefined
      }
      toggleLabel={label()}
      tooltipLabel={blocked() ? t('calls.cameraBlockedTooltip') : undefined}
      menuLabel="Video settings"
      mobileContent={props.mobileContent}
      disabled={bar.props.disabled}
      onToggle={props.onToggle}
      icon={
        <Show
          when={props.muted || blocked()}
          fallback={<VideoCamera class={bar.iconClass()} />}
        >
          <VideoCameraSlash
            class={cn(bar.iconClass(), blocked() && 'text-ink-subtle')}
          />
        </Show>
      }
    >
      {props.children}
    </MediaSplitButton>
  );
}

function ScreenControl(props: {
  sharing: boolean;
  unavailable?: boolean;
  onToggle: () => void;
  children: JSX.Element;
  mobileContent: JSX.Element;
}) {
  const bar = useControlBar();
  return (
    <Show when={!isMobile()}>
      <MediaSplitButton
        device="screen"
        label="Screen share"
        hideMenu={bar.props.compact && !bar.props.unframed}
        mobileContent={props.mobileContent}
        toggleLabel={props.sharing ? 'Stop sharing screen' : 'Share screen'}
        menuLabel="Screen share settings"
        pressed={props.sharing}
        disabled={bar.props.disabled || props.unavailable}
        onToggle={props.onToggle}
        icon={<Screencast class={bar.iconClass()} />}
      >
        {props.children}
      </MediaSplitButton>
    </Show>
  );
}

function LeaveControl(props: { onLeave: () => void }) {
  const bar = useControlBar();
  return (
    <Button
      size={bar.props.compact ? 'icon-md' : 'icon-lg'}
      variant="danger"
      aria-label={t('calls.leave')}
      class={cn(
        'rounded-full',
        !bar.props.unframed && (bar.props.compact ? 'min-w-11' : 'min-w-14')
      )}
      tooltip={{ content: t('calls.leave'), placement: 'top' }}
      onClick={props.onLeave}
    >
      <PhoneDisconnect class={bar.iconClass()} />
    </Button>
  );
}

function ErrorMessage(props: { children: JSX.Element }) {
  return (
    <Show when={props.children}>
      <p
        role="alert"
        class="absolute inset-x-0 top-full rounded-lg bg-panel p-2 text-center text-xs text-failure mobile:top-auto mobile:bottom-full mobile:mb-2"
      >
        {props.children}
      </p>
    </Show>
  );
}

export const CallControlBar = {
  Root,
  Microphone: MicrophoneControl,
  Camera: CameraControl,
  Screen: ScreenControl,
  Leave: LeaveControl,
  Error: ErrorMessage,
};
