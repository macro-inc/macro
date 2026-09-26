import CaretUp from '@phosphor/caret-up.svg';
import Image from '@phosphor/image.svg';
import Microphone from '@phosphor/microphone.svg';
import MicrophoneSlash from '@phosphor/microphone-slash.svg';
import PhoneDisconnect from '@phosphor/phone-disconnect.svg';
import Screencast from '@phosphor/screencast.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import VideoCameraSlash from '@phosphor/video-camera-slash.svg';
import { Button } from '@ui';
import {
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

export function CallControlButton(props: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <Button
      size="icon-lg"
      variant={props.danger ? 'danger' : 'ghost'}
      label={props.label}
      tooltipPlacement="top"
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
      class="size-12"
    >
      {props.children}
    </Button>
  );
}

type SettingsSection = 'audio' | 'video' | 'background';
const settingsLabels: Record<SettingsSection, string> = {
  audio: 'Audio settings',
  video: 'Camera settings',
  background: 'Background settings',
};

/** Settings grow upward without moving the controls or resizing participant tiles. */
export function CallControlBar(props: {
  disabled: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  screenSharing: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
  menuOpen: boolean;
  audioSettings: JSX.Element;
  videoSettings: JSX.Element;
  backgroundActive: boolean;
  backgroundDisabled: boolean;
  onToggleBackground: () => void;
  backgroundSettings: JSX.Element;
  error?: string;
}) {
  const [section, setSection] = createSignal<SettingsSection>();
  const [pinned, setPinned] = createSignal(false);
  const [lastSection, setLastSection] = createSignal<SettingsSection>('audio');
  const displayedSection = () => section() ?? lastSection();
  const id = createUniqueId();
  let root!: HTMLDivElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let intentTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelIntent = () => clearTimeout(intentTimer);
  const open = (next: SettingsSection) => {
    cancelIntent();
    setLastSection(next);
    setSection(next);
  };
  const cancelClose = () => clearTimeout(timer);
  const close = () => {
    cancelIntent();
    cancelClose();
    setSection(undefined);
    setPinned(false);
  };
  const scheduleClose = () => {
    cancelIntent();
    cancelClose();
    timer = setTimeout(() => {
      if (
        !pinned() &&
        !props.menuOpen &&
        !root.contains(document.activeElement)
      )
        close();
    }, 320);
  };
  const preview = (next: SettingsSection, event: PointerEvent) => {
    cancelClose();
    cancelIntent();
    if (event.pointerType === 'mouse' && !pinned() && !props.menuOpen)
      intentTimer = setTimeout(() => open(next), 140);
  };
  const toggle = (next: SettingsSection) => {
    cancelIntent();
    cancelClose();
    if (section() === next && pinned()) close();
    else {
      open(next);
      setPinned(true);
    }
  };
  onMount(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        !props.menuOpen &&
        event.target instanceof Node &&
        !root.contains(event.target)
      )
        close();
    };
    document.addEventListener('pointerdown', dismiss);
    onCleanup(() => document.removeEventListener('pointerdown', dismiss));
  });
  onCleanup(() => {
    cancelClose();
    cancelIntent();
  });

  function MediaGroup(group: {
    kind: SettingsSection;
    active: boolean;
    label: string;
    toggleLabel: string;
    disabled?: boolean;
    onToggle: () => void;
    children: JSX.Element;
  }) {
    const expanded = () => section() === group.kind;
    return (
      <div
        role="group"
        aria-label={group.label}
        class="flex items-center gap-0.5"
        onPointerEnter={(event) => preview(group.kind, event)}
        onPointerLeave={cancelIntent}
      >
        <CallControlButton
          label={group.toggleLabel}
          pressed={group.active}
          disabled={props.disabled || group.disabled}
          onClick={group.onToggle}
        >
          {group.children}
        </CallControlButton>
        <Button
          size="icon-md"
          tooltipDisabled
          variant="plain"
          aria-label={settingsLabels[group.kind]}
          aria-expanded={expanded()}
          aria-controls={expanded() ? id : undefined}
          onClick={(event) => {
            toggle(group.kind);
            if (event.detail === 0 && section() === group.kind) {
              root
                .querySelector<HTMLButtonElement>(
                  '[data-settings-active="true"] button:not(:disabled)'
                )
                ?.focus();
            }
          }}
          class="h-12 w-6 @sm:w-8"
        >
          <CaretUp
            class="size-4 transition-transform duration-200 ease-out motion-reduce:transition-none"
            classList={{ 'rotate-180': expanded() }}
          />
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={root}
      data-call-controls
      class="@container relative z-20 w-full max-w-xl"
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
      onFocusOut={scheduleClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !props.menuOpen) {
          const active = section();
          if (!active) return;
          event.preventDefault();
          root
            .querySelector<HTMLButtonElement>(
              `button[aria-label="${settingsLabels[active]}"]`
            )
            ?.focus();
          close();
        }
      }}
    >
      <div
        id={id}
        role="region"
        aria-label={settingsLabels[displayedSection()]}
        aria-hidden={!section()}
        inert={!section()}
        data-state={section() ? 'open' : 'closed'}
        class="absolute inset-x-0 bottom-full pb-2 transition-[opacity,translate,visibility] duration-200 ease-out motion-reduce:transition-none"
        classList={{
          'visible translate-y-0 opacity-100': !!section(),
          'invisible translate-y-2 opacity-0 pointer-events-none': !section(),
        }}
        onPointerEnter={() => {
          cancelClose();
          cancelIntent();
        }}
      >
        <div class="rounded-xl border border-edge-muted bg-panel shadow-md">
          <div
            aria-hidden={displayedSection() !== 'audio'}
            inert={displayedSection() !== 'audio'}
            data-settings-active={displayedSection() === 'audio'}
            class="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
            classList={{
              'grid-rows-[1fr] opacity-100': displayedSection() === 'audio',
              'grid-rows-[0fr] opacity-0': displayedSection() !== 'audio',
            }}
          >
            <div class="min-h-0 overflow-hidden">
              <div class="p-3">{props.audioSettings}</div>
            </div>
          </div>
          <div
            aria-hidden={displayedSection() !== 'video'}
            inert={displayedSection() !== 'video'}
            data-settings-active={displayedSection() === 'video'}
            class="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
            classList={{
              'grid-rows-[1fr] opacity-100': displayedSection() === 'video',
              'grid-rows-[0fr] opacity-0': displayedSection() !== 'video',
            }}
          >
            <div class="min-h-0 overflow-hidden">
              <div class="p-3">{props.videoSettings}</div>
            </div>
          </div>
          <div
            aria-hidden={displayedSection() !== 'background'}
            inert={displayedSection() !== 'background'}
            data-settings-active={displayedSection() === 'background'}
            class="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
            classList={{
              'grid-rows-[1fr] opacity-100':
                displayedSection() === 'background',
              'grid-rows-[0fr] opacity-0': displayedSection() !== 'background',
            }}
          >
            <div class="min-h-0 overflow-hidden">
              <div class="p-3">{props.backgroundSettings}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-edge-muted bg-panel p-1.5 shadow-sm @sm:gap-2">
        <MediaGroup
          kind="audio"
          active={!props.audioMuted}
          label="Microphone controls"
          toggleLabel={
            props.audioMuted ? 'Unmute microphone' : 'Mute microphone'
          }
          onToggle={props.onToggleAudio}
        >
          <Show when={props.audioMuted} fallback={<Microphone />}>
            <MicrophoneSlash />
          </Show>
        </MediaGroup>
        <MediaGroup
          kind="video"
          active={!props.videoMuted}
          label="Camera controls"
          toggleLabel={props.videoMuted ? 'Turn on camera' : 'Turn off camera'}
          onToggle={props.onToggleVideo}
        >
          <Show when={props.videoMuted} fallback={<VideoCamera />}>
            <VideoCameraSlash />
          </Show>
        </MediaGroup>
        <MediaGroup
          kind="background"
          active={props.backgroundActive}
          disabled={props.backgroundDisabled}
          label="Background controls"
          toggleLabel={
            props.backgroundActive
              ? 'Turn off background'
              : 'Turn on background'
          }
          onToggle={props.onToggleBackground}
        >
          <Image />
        </MediaGroup>
        <CallControlButton
          label={props.screenSharing ? 'Stop sharing screen' : 'Share screen'}
          pressed={props.screenSharing}
          disabled={props.disabled}
          onClick={props.onToggleScreen}
        >
          <Screencast />
        </CallControlButton>
        <CallControlButton label="Leave call" danger onClick={props.onLeave}>
          <PhoneDisconnect />
        </CallControlButton>
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
