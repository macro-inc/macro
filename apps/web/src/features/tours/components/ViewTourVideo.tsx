import PlayIcon from '@phosphor/play.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { ViewTourVideo as Video } from '../core/view-tour';

/** Load the third-party player only after an explicit play action. */
export function ViewTourVideo(props: { video: Video }) {
  const [playing, setPlaying] = createSignal(false);
  return (
    <div class="mt-4 border-t border-edge-muted pt-3">
      <Show
        when={playing()}
        fallback={
          <button
            type="button"
            onClick={() => setPlaying(true)}
            class="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-hover"
            aria-label={`Watch ${props.video.title}`}
          >
            <PlayIcon class="size-4 shrink-0" />
            <span class="min-w-0 flex-1">
              <span class="block text-xs text-ink">{props.video.title}</span>
              <span class="mt-1 block text-[10px] text-ink-muted">
                Watch video · {props.video.duration}
              </span>
            </span>
          </button>
        }
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <span class="min-w-0 truncate text-xs text-ink">
            {props.video.title}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Close video"
            onClick={() => setPlaying(false)}
          >
            <XIcon />
          </Button>
        </div>
        <iframe
          class="aspect-video w-full rounded-lg border-0 bg-surface"
          src={`https://www.youtube-nocookie.com/embed/${props.video.youtubeId}?autoplay=1&rel=0`}
          title={props.video.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        />
      </Show>
    </div>
  );
}
