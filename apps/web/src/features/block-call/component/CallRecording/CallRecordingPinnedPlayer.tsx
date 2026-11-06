import { formatVideoTimestamp } from '@core/util/duration';
import ForwardIcon from '@icon/system/regular/arrow-clockwise.svg';
import BackIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import FullscreenIcon from '@icon/system/regular/corners-out.svg';
import PauseIcon from '@icon/system/regular/pause.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import { Button } from '@ui';
import { ProgressRing } from '@ui/components/ProgressPill';
import { Show } from 'solid-js';
import type { RecordingPlayback } from '../../primitives/recording-playback';

export function CallRecordingPinnedPlayer(props: {
  playback: RecordingPlayback;
  speaker: string;
  onShowVideo: () => void;
  mobile?: boolean;
}) {
  const state = () => props.playback;
  return (
    <div
      class="menu-surface pointer-events-auto flex min-w-0 items-center gap-1 rounded-2xl p-2"
      role="group"
      aria-label="Recording playback"
    >
      <div class="relative flex size-11 shrink-0 items-center justify-center">
        <div class="pointer-events-none absolute inset-0">
          <ProgressRing
            size="lg"
            fraction={
              state().duration() ? state().time() / state().duration() : 0
            }
          />
        </div>
        <Button
          variant="primary"
          size="icon-sm"
          aria-label={state().paused() ? 'Play' : 'Pause'}
          onClick={state().toggle}
        >
          <Show when={state().paused()} fallback={<PauseIcon class="size-4" />}>
            <PlayIcon class="size-4" />
          </Show>
        </Button>
      </div>
      <div class="ml-1 mr-auto min-w-0">
        <div class="truncate text-sm font-medium">{props.speaker}</div>
        <div class="whitespace-nowrap text-xs tabular-nums text-ink-muted">
          {formatVideoTimestamp(state().time())} /{' '}
          {formatVideoTimestamp(state().duration())}
        </div>
      </div>
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
      <Button
        variant="ghost"
        size={props.mobile ? 'icon-sm' : 'sm'}
        aria-label={props.mobile ? 'Fullscreen' : 'Show video'}
        onClick={props.mobile ? state().fullscreen : props.onShowVideo}
      >
        <FullscreenIcon class="size-4" />
        <Show when={!props.mobile}>Show video</Show>
      </Button>
    </div>
  );
}
