import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import { formatVideoTimestamp } from '@core/util/duration';
import ForwardIcon from '@icon/system/regular/arrow-clockwise.svg';
import BackIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import FullscreenIcon from '@icon/system/regular/corners-out.svg';
import PauseIcon from '@icon/system/regular/pause.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import VolumeIcon from '@icon/system/regular/speaker-high.svg';
import MutedVolumeIcon from '@icon/system/regular/speaker-slash.svg';
import TranscriptIcon from '@icon/system/regular/text-align-left.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Dropdown, Slider } from '@ui';
import { For, Show } from 'solid-js';
import { createRecordingControlMenus } from '../../primitives/recording-control-menus';
import type { RecordingControlsVisibility } from '../../primitives/recording-controls';
import {
  RECORDING_PLAYBACK_RATES,
  type RecordingPlayback,
} from '../../primitives/recording-playback';
import { createRecordingVolume } from '../../primitives/recording-volume';

const CONTROL_MOTION =
  'transition-[transform,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transform-none';

type TranscriptControl = { visible: boolean; onToggle: () => void };

function DesktopRecordingControls(props: {
  playback: RecordingPlayback;
  visibility: RecordingControlsVisibility;
  transcript?: TranscriptControl;
}) {
  const state = () => props.playback;
  const menus = createRecordingControlMenus(() => props.visibility);
  return (
    <div
      ref={menus.setControlsRef}
      data-recording-controls
      class={`${CONTROL_MOTION} absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-surface/95 px-3 pb-2 pt-1`}
      classList={{
        'opacity-0 pointer-events-none transform-[translateY(100%)]':
          !props.visibility.visible(),
        'opacity-100 pointer-events-auto transform-[translateY(0)]':
          props.visibility.visible(),
      }}
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
        <Dropdown placement="top-end" onOpenChange={menus.setSpeedOpen}>
          <Dropdown.Trigger
            variant="ghost"
            size="sm"
            aria-label={t('calls.detailSpeed')}
            tooltip={t('calls.detailSpeed')}
          >
            {state().rate()}×
          </Dropdown.Trigger>
          <Dropdown.Content mount={menus.mount()} class="min-w-40">
            <Dropdown.Group>
              <Dropdown.RadioGroup
                value={String(state().rate())}
                onChange={(value) => state().setRate(Number(value))}
              >
                <For each={RECORDING_PLAYBACK_RATES}>
                  {(rate) => (
                    <Dropdown.RadioItem value={String(rate)} closeOnSelect>
                      <span class="flex-1">{rate}×</span>
                      <Dropdown.ItemIndicator>
                        <CheckIcon class="size-3.5 text-accent" />
                      </Dropdown.ItemIndicator>
                    </Dropdown.RadioItem>
                  )}
                </For>
              </Dropdown.RadioGroup>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
        <Show when={props.transcript}>
          {(control) => (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('calls.detailTranscript')}
              aria-pressed={control().visible}
              tooltip={t('calls.detailTranscript')}
              onClick={() => control().onToggle()}
            >
              <TranscriptIcon class="size-4" />
            </Button>
          )}
        </Show>
        <RecordingVolume
          playback={props.playback}
          mount={menus.mount()}
          open={menus.volumeOpen()}
          onTabForward={menus.focusFullscreen}
          onOpenChange={menus.setVolumeOpen}
        />
        <Button
          ref={menus.setFullscreenRef}
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
  const volume = createRecordingVolume({
    onOpenChange: (open) => props.onOpenChange(open),
    onTabForward: () => props.onTabForward(),
    toggleMute: () => props.playback.toggleMute(),
  });

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
        ref={volume.setTrigger}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        variant="ghost"
        size="icon-sm"
        aria-label={silent() ? t('calls.detailUnmute') : t('calls.detailMute')}
        onPointerEnter={volume.open}
        onPointerLeave={volume.close}
        onFocus={volume.onFocus}
        onBlur={volume.close}
        onClick={volume.onClick}
        onKeyDown={volume.onTriggerKeyDown}
      >
        <Show when={silent()} fallback={<VolumeIcon class="size-4" />}>
          <MutedVolumeIcon class="size-4" />
        </Show>
      </Popover.Anchor>
      <Popover.Portal mount={props.mount}>
        <Popover.Content
          ref={volume.setContent}
          class="menu-surface z-action-menu p-3 outline-none"
          onPointerEnter={volume.open}
          onPointerLeave={volume.close}
          onFocusIn={volume.onContentFocus}
          onFocusOut={volume.close}
          onInteractOutside={volume.onInteractOutside}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={volume.onEscape}
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
            onKeyDown={volume.onSliderKeyDown}
          >
            <Slider.Track class="my-0">
              <Slider.Fill class="h-auto" />
              <Slider.Thumb
                ref={volume.setThumb}
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

function MobileRecordingControls(props: {
  playback: RecordingPlayback;
  visibility: RecordingControlsVisibility;
  transcript?: TranscriptControl;
}) {
  return (
    <>
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center pb-12">
        <div
          class={CONTROL_MOTION}
          classList={{
            'opacity-0 pointer-events-none transform-[translateY(100%)]':
              !props.visibility.visible(),
            'opacity-100 pointer-events-auto transform-[translateY(0)]':
              props.visibility.visible(),
          }}
        >
          <Button
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
      </div>
      <div
        data-recording-controls
        class={`${CONTROL_MOTION} absolute inset-x-0 bottom-0 bg-surface/95 px-3 pb-2`}
        classList={{
          'opacity-0 pointer-events-none transform-[translateY(100%)]':
            !props.visibility.visible(),
          'opacity-100 pointer-events-auto transform-[translateY(0)]':
            props.visibility.visible(),
        }}
      >
        <div class="flex items-center gap-2 text-xs tabular-nums">
          <span class="mr-auto">
            {formatVideoTimestamp(props.playback.time())}
          </span>
          <span class="text-ink-muted">
            {formatVideoTimestamp(props.playback.duration())}
          </span>
          <Show when={props.transcript}>
            {(control) => (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('calls.detailTranscript')}
                aria-pressed={control().visible}
                tooltip={t('calls.detailTranscript')}
                onClick={() => control().onToggle()}
              >
                <TranscriptIcon class="size-4" />
              </Button>
            )}
          </Show>
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
  transcript?: TranscriptControl;
}) {
  return (
    <div
      class="pointer-events-none absolute inset-0"
      inert={!props.visibility.visible()}
      aria-hidden={!props.visibility.visible()}
    >
      <Show
        when={isMobile()}
        fallback={
          <DesktopRecordingControls
            playback={props.playback}
            visibility={props.visibility}
            transcript={props.transcript}
          />
        }
      >
        <MobileRecordingControls
          playback={props.playback}
          visibility={props.visibility}
          transcript={props.transcript}
        />
      </Show>
    </div>
  );
}
