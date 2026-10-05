/**
 * A clip playing over its shape, with the browser's controls: a video fills
 * the shape's box, an audio player sits under its icon. Linked clips the
 * browser cannot play offer their address instead.
 */

import type { MediaOutline } from '@core/pptx-engine/types';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import Play from '@phosphor-fill/play-fill.svg';
import { createResource, createSignal, Match, Show, Switch } from 'solid-js';
import { playableUrl } from '../core/media';
import type { MediaUrls } from '../primitives/create-media-urls';

/** A box in the container's CSS pixels. */
export interface MediaBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function MediaPlayer(props: {
  media: MediaOutline;
  box: MediaBox;
  urls: MediaUrls;
  testId?: string;
  onEnded?: () => void;
}) {
  const [src] = createResource(
    () => props.media,
    (media) => props.urls.urlOf(media)
  );
  const [failed, setFailed] = createSignal(false);
  const link = () => playableUrl(props.media.url);
  const stop = (e: Event) => e.stopPropagation();
  return (
    <div
      class="absolute z-10"
      style={{
        left: `${props.box.x}px`,
        top: `${props.box.y}px`,
        width: `${props.box.w}px`,
        height: `${props.box.h}px`,
      }}
      data-testid={props.testId ?? 'pptx-media-player'}
      data-media-player
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onDblClick={stop}
      onContextMenu={stop}
    >
      <Switch>
        <Match when={failed() || (src.state === 'ready' && !src())}>
          <div class="flex size-full min-h-10 items-center justify-center bg-[black]/70 p-2 text-center text-[white] text-xs">
            <Show when={link()} fallback="This clip can't be played here.">
              {(url) => (
                <a
                  href={url()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 underline"
                >
                  <ArrowSquareOut class="size-3.5" />
                  Open the linked clip
                </a>
              )}
            </Show>
          </div>
        </Match>
        <Match when={src() && props.media.kind === 'video'}>
          <video
            src={src()}
            class="size-full bg-[black] object-contain"
            controls
            autoplay
            playsinline
            data-testid="pptx-media-video"
            onEnded={() => props.onEnded?.()}
            onError={() => setFailed(true)}
          />
        </Match>
        <Match when={src() && props.media.kind === 'audio'}>
          <audio
            src={src()}
            class="absolute top-full left-1/2 mt-1 w-72 max-w-[80vw] -translate-x-1/2"
            controls
            autoplay
            data-testid="pptx-media-audio"
            onEnded={() => props.onEnded?.()}
            onError={() => setFailed(true)}
          />
        </Match>
      </Switch>
    </div>
  );
}

/** The play button PowerPoint shows on a selected video or audio shape. */
export function MediaPlayButton(props: {
  box: MediaBox;
  kind: 'video' | 'audio';
  onPlay: () => void;
}) {
  const stop = (e: Event) => e.stopPropagation();
  return (
    <button
      type="button"
      class="absolute z-10 flex size-8 items-center justify-center rounded-full bg-[black]/70 text-[white] shadow hover:bg-[black]/85"
      style={{
        left: `${props.box.x + 8}px`,
        top: `${Math.max(props.box.y, props.box.y + props.box.h - 40)}px`,
      }}
      aria-label={props.kind === 'video' ? 'Play video' : 'Play audio'}
      title={props.kind === 'video' ? 'Play video' : 'Play audio'}
      data-testid="pptx-media-play"
      onPointerDown={stop}
      onMouseDown={stop}
      onDblClick={stop}
      onClick={(e) => {
        e.stopPropagation();
        props.onPlay();
      }}
    >
      <Play class="size-4" />
    </button>
  );
}
