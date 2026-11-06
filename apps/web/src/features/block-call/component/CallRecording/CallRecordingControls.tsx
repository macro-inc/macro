import { isMobile } from '@core/mobile/isMobile';
import { formatVideoTimestamp } from '@core/util/duration';
import ForwardIcon from '@icon/system/regular/arrow-clockwise.svg';
import BackIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import FullscreenIcon from '@icon/system/regular/corners-out.svg';
import PauseIcon from '@icon/system/regular/pause.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import VolumeIcon from '@icon/system/regular/speaker-high.svg';
import { Button, Slider } from '@ui';
import { Show } from 'solid-js';
import type { RecordingPlayback } from '../../primitives/recording-playback';

function DesktopRecordingControls(props: { playback: RecordingPlayback }) {
  const state = () => props.playback;
  return (
    <div class="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-surface/95 px-3 pb-2 pt-1">
      <RecordingScrubber playback={props.playback} />
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={state().paused() ? 'Play' : 'Pause'}
          tooltip={state().paused() ? 'Play' : 'Pause'}
          onClick={state().toggle}
        >
          <Show when={state().paused()} fallback={<PauseIcon class="size-4" />}>
            <PlayIcon class="size-4" />
          </Show>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Skip back"
          tooltip="Skip back"
          onClick={() => state().skip(-10)}
        >
          <BackIcon class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Skip forward"
          tooltip="Skip forward"
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
        <Button
          variant="ghost"
          size="sm"
          aria-label="Playback speed"
          tooltip="Playback speed"
          onClick={state().cycleRate}
        >
          {state().rate()}×
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={state().muted() ? 'Unmute' : 'Mute'}
          tooltip={state().muted() ? 'Unmute' : 'Mute'}
          onClick={state().toggleMute}
        >
          <VolumeIcon class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Fullscreen"
          tooltip="Fullscreen"
          onClick={state().fullscreen}
        >
          <FullscreenIcon class="size-4" />
        </Button>
      </div>
    </div>
  );
}

function RecordingScrubber(props: { playback: RecordingPlayback }) {
  return (
    <Slider
      aria-label="Recording position"
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
          aria-label="Recording position"
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
          aria-label={props.playback.paused() ? 'Play' : 'Pause'}
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
      <div class="absolute inset-x-0 bottom-0 bg-surface/95 px-3 pb-2">
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
            aria-label="Fullscreen"
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

export function CallRecordingControls(props: { playback: RecordingPlayback }) {
  return (
    <Show
      when={isMobile()}
      fallback={<DesktopRecordingControls playback={props.playback} />}
    >
      <MobileRecordingControls playback={props.playback} />
    </Show>
  );
}
