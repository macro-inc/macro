import PlayIcon from '@phosphor/play.svg';
import { createSignal, Show } from 'solid-js';
import type { ViewGuideVideo } from '../core/viewGuides';

/** Load the third-party player only after an explicit play action. */
export function ViewGuideVideoPlayer(props: { video: ViewGuideVideo }) {
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
        <iframe
          class="aspect-video w-full rounded-lg border-0 bg-surface"
          src={`https://www.youtube-nocookie.com/embed/${props.video.youtubeId}?autoplay=1&rel=0`}
          title={props.video.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        />
        <div class="mt-2 flex items-center justify-between gap-2 text-[10px] text-ink-muted">
          <a
            href={`https://www.youtube.com/watch?v=${props.video.youtubeId}`}
            target="_blank"
            rel="noopener noreferrer"
            class="rounded px-1 py-1 hover:text-ink"
          >
            Watch on YouTube
          </a>
          <button
            type="button"
            onClick={() => setPlaying(false)}
            class="rounded px-1 py-1 hover:text-ink"
          >
            Close video
          </button>
        </div>
      </Show>
    </div>
  );
}
