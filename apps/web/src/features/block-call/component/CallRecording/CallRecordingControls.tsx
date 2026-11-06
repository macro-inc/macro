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

export function CallRecordingControls(props: { playback: RecordingPlayback }) {
  const state = () => props.playback;
  return (
    <div class="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-surface/95 px-3 pb-2 pt-1">
      <Slider
        aria-label="Recording position"
        minValue={0}
        maxValue={state().duration() || 1}
        step={0.1}
        value={[state().time()]}
        onChange={(value) => state().seek(value[0])}
        disabled={!state().duration()}
      >
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb
            aria-label="Recording position"
            aria-valuetext={formatVideoTimestamp(state().time())}
          >
            <Slider.Input />
          </Slider.Thumb>
        </Slider.Track>
      </Slider>
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
