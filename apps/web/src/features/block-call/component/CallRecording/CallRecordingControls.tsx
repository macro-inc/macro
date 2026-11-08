import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import { debounce } from '@core/util/debounce';
import { formatVideoTimestamp } from '@core/util/duration';
import ForwardIcon from '@icon/system/regular/arrow-clockwise.svg';
import BackIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import FullscreenIcon from '@icon/system/regular/corners-out.svg';
import PauseIcon from '@icon/system/regular/pause.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import VolumeIcon from '@icon/system/regular/speaker-high.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Dropdown, Slider } from '@ui';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { RecordingControlsVisibility } from '../../primitives/recording-controls';
import {
  RECORDING_PLAYBACK_RATES,
  type RecordingPlayback,
} from '../../primitives/recording-playback';

function DesktopRecordingControls(props: {
  playback: RecordingPlayback;
  visibility: RecordingControlsVisibility;
}) {
  const state = () => props.playback;
  let controlsRef!: HTMLDivElement;
  let fullscreenRef: HTMLButtonElement | undefined;
  const [menuMount, setMenuMount] = createSignal<HTMLElement>();
  const [speedOpen, setSpeedOpen] = createSignal(false);
  const [volumeOpen, setVolumeOpen] = createSignal(false);
  onCleanup(() => props.visibility.setMenuOpen(false));
  onMount(() => {
    const updateMenuMount = () => {
      const fullscreen = document.fullscreenElement;
      setMenuMount(
        fullscreen instanceof HTMLElement && fullscreen.contains(controlsRef)
          ? fullscreen
          : undefined
      );
    };
    updateMenuMount();
    document.addEventListener('fullscreenchange', updateMenuMount);
    onCleanup(() =>
      document.removeEventListener('fullscreenchange', updateMenuMount)
    );
  });
  return (
    <div
      ref={controlsRef}
      data-recording-controls
      class="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-surface/95 px-3 pb-2 pt-1"
    >
      <RecordingScrubber playback={props.playback} />
      <div class="flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            state().paused() ? t('calls.detailPlay') : t('calls.detailPause')
          }
          tooltip={
            state().paused() ? t('calls.detailPlay') : t('calls.detailPause')
          }
          onClick={state().toggle}
        >
          <Show when={state().paused()} fallback={<PauseIcon class="size-4" />}>
            <PlayIcon class="size-4" />
          </Show>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('calls.detailSkipBack')}
          tooltip={t('calls.detailSkipBack')}
          onClick={() => state().skip(-10)}
        >
          <BackIcon class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('calls.detailSkipForward')}
          tooltip={t('calls.detailSkipForward')}
          onClick={() => state().skip(10)}
        >
          <ForwardIcon class="size-4" />
        </Button>
        <span class="mr-auto min-w-0 whitespace-nowrap text-xs tabular-nums">
          {formatVideoTimestamp(state().time())}{' '}
          <span class="text-ink-muted">
            / {formatVideoTimestamp(state().duration())}
          </span>
        </span>
        <Dropdown
          placement="top-end"
          onOpenChange={(open) => {
            setSpeedOpen(open);
            props.visibility.setMenuOpen(open || volumeOpen());
          }}
        >
          <Dropdown.Trigger
            variant="ghost"
            size="sm"
            aria-label={t('calls.detailSpeed')}
            tooltip={t('calls.detailSpeed')}
          >
            {state().rate()}×
          </Dropdown.Trigger>
          <Dropdown.Content mount={menuMount()} class="min-w-28">
            <Dropdown.RadioGroup
              value={String(state().rate())}
              onChange={(value) => state().setRate(Number(value))}
            >
              <For each={RECORDING_PLAYBACK_RATES}>
                {(rate) => (
                  <Dropdown.RadioItem value={String(rate)} closeOnSelect>
                    <span class="flex-1">{rate}×</span>
                    <Dropdown.ItemIndicator>
                      <CheckIcon class="size-4" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Dropdown.Content>
        </Dropdown>
        <RecordingVolume
          playback={props.playback}
          mount={menuMount()}
          open={volumeOpen()}
          onTabForward={() => fullscreenRef?.focus()}
          onOpenChange={(open) => {
            setVolumeOpen(open);
            props.visibility.setMenuOpen(open || speedOpen());
          }}
        />
        <Button
          ref={fullscreenRef}
          variant="ghost"
          size="icon-sm"
          aria-label={t('calls.detailFullscreen')}
          tooltip={t('calls.detailFullscreen')}
          onClick={state().fullscreen}
        >
          <FullscreenIcon class="size-4" />
        </Button>
      </div>
    </div>
  );
}

function RecordingVolume(props: {
  playback: RecordingPlayback;
  mount?: HTMLElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTabForward: () => void;
}) {
  const silent = () => props.playback.muted() || props.playback.volume() === 0;
  let trigger!: HTMLButtonElement;
  let content: HTMLDivElement | undefined;
  let thumb: HTMLSpanElement | undefined;
  let restoringFocus = false;
  const close = debounce(() => {
    if (
      trigger !== document.activeElement &&
      !content?.contains(document.activeElement)
    )
      props.onOpenChange(false);
  }, 150);
  const open = () => {
    close.clear();
    props.onOpenChange(true);
  };
  onCleanup(() => close.clear());

  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="top"
      gutter={8}
      modal={false}
    >
      <Popover.Anchor
        as={Button}
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        variant="ghost"
        size="icon-sm"
        aria-label={silent() ? t('calls.detailUnmute') : t('calls.detailMute')}
        onPointerEnter={open}
        onPointerLeave={close}
        onFocus={() => {
          if (!restoringFocus) open();
        }}
        onBlur={close}
        onClick={() => {
          props.playback.toggleMute();
          open();
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown' ||
            (event.key === 'Tab' && !event.shiftKey)
          ) {
            event.preventDefault();
            open();
            queueMicrotask(() => thumb?.focus());
          }
        }}
      >
        <VolumeIcon class="size-4" classList={{ 'opacity-50': silent() }} />
      </Popover.Anchor>
      <Popover.Portal mount={props.mount}>
        <Popover.Content
          ref={content}
          class="menu-surface z-action-menu p-3 outline-none"
          onPointerEnter={open}
          onPointerLeave={close}
          onFocusIn={() => close.clear()}
          onFocusOut={close}
          onInteractOutside={(event) => {
            if (
              event.target instanceof Node &&
              trigger.contains(event.target)
            ) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => {
            restoringFocus = true;
            trigger.focus({ preventScroll: true });
            restoringFocus = false;
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <Popover.Title class="sr-only">
            {t('calls.detailVolume')}
          </Popover.Title>
          <Slider
            class="h-28 items-center"
            orientation="vertical"
            aria-label={t('calls.detailVolume')}
            minValue={0}
            maxValue={1}
            step={0.05}
            value={[silent() ? 0 : props.playback.volume()]}
            onChange={(values) => props.playback.setVolume(values[0])}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== 'Tab') return;
              event.preventDefault();
              if (event.shiftKey) {
                trigger.focus({ preventScroll: true });
              } else {
                props.onTabForward();
                props.onOpenChange(false);
              }
            }}
          >
            <Slider.Track class="my-0">
              <Slider.Fill class="h-auto" />
              <Slider.Thumb
                ref={thumb}
                aria-label={t('calls.detailVolume')}
                class="bg-[white] border-border-secondary"
              >
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
function RecordingScrubber(props: { playback: RecordingPlayback }) {
  return (
    <Slider
      aria-label={t('calls.detailPosition')}
      minValue={0}
      maxValue={props.playback.duration() || 1}
      step={0.1}
      value={[props.playback.time()]}
      onChange={(value) => props.playback.seek(value[0])}
      disabled={!props.playback.duration()}
    >
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb
          class="bg-[white] border-border-secondary"
          aria-label={t('calls.detailPosition')}
          aria-valuetext={formatVideoTimestamp(props.playback.time())}
        >
          <Slider.Input />
        </Slider.Thumb>
      </Slider.Track>
    </Slider>
  );
}

function MobileRecordingControls(props: { playback: RecordingPlayback }) {
  return (
    <>
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center pb-12">
        <Button
          class="pointer-events-auto"
          variant="secondary"
          size="icon-xl"
          aria-label={
            props.playback.paused()
              ? t('calls.detailPlay')
              : t('calls.detailPause')
          }
          onClick={props.playback.toggle}
        >
          <Show
            when={props.playback.paused()}
            fallback={<PauseIcon class="size-7" />}
          >
            <PlayIcon class="size-7" />
          </Show>
        </Button>
      </div>
      <div class="pointer-events-auto absolute inset-x-0 bottom-0 bg-surface/95 px-3 pb-2">
        <div class="flex items-center gap-2 text-xs tabular-nums">
          <span class="mr-auto">
            {formatVideoTimestamp(props.playback.time())}
          </span>
          <span class="text-ink-muted">
            {formatVideoTimestamp(props.playback.duration())}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('calls.detailFullscreen')}
            onClick={props.playback.fullscreen}
          >
            <FullscreenIcon class="size-4" />
          </Button>
        </div>
        <RecordingScrubber playback={props.playback} />
      </div>
    </>
  );
}

export function CallRecordingControls(props: {
  playback: RecordingPlayback;
  visibility: RecordingControlsVisibility;
}) {
  return (
    <div
      class="pointer-events-none absolute inset-0 transition-[translate,opacity] duration-200 ease-out motion-reduce:translate-y-0"
      classList={{
        'opacity-0 translate-y-full': !props.visibility.visible(),
      }}
      inert={!props.visibility.visible()}
      aria-hidden={!props.visibility.visible()}
    >
      <Show
        when={isMobile()}
        fallback={
          <DesktopRecordingControls
            playback={props.playback}
            visibility={props.visibility}
          />
        }
      >
        <MobileRecordingControls playback={props.playback} />
      </Show>
    </div>
  );
}
