/**
 * Video and audio in Presenter View, as PowerPoint plays them: a clip plays
 * on the audience screen, while the console mirrors a video silently over
 * its current slide and gives the presenter the controls. With the
 * audience window closed, the console's copy plays the sound.
 */

import type { MediaOutline } from '@core/pptx-engine/types';
import Pause from '@phosphor-fill/pause-fill.svg';
import Play from '@phosphor-fill/play-fill.svg';
import Stop from '@phosphor-fill/stop-fill.svg';
import {
  createEffect,
  createResource,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { formatTime } from '../core/media';
import type { MediaUrls } from '../primitives/create-media-urls';
import type { MediaBox } from './media-player';

const boxStyle = (box: MediaBox): JSX.CSSProperties => ({
  position: 'absolute',
  left: `${box.x}px`,
  top: `${box.y}px`,
  width: `${box.w}px`,
  height: `${box.h}px`,
});

/**
 * The audience window's copy of a playing clip. That window has none of
 * the app's styles, so everything here is styled inline; it has no
 * controls of its own (the presenter has them).
 */
export function AudienceClip(props: {
  media: MediaOutline;
  box: MediaBox;
  urls: MediaUrls;
  /** The element, once it can play (and `undefined` when it goes away). */
  onElement: (el: HTMLMediaElement | undefined) => void;
  /** Whether the window refused to play it with sound (it plays muted). */
  onMuted: () => void;
  onEnded: () => void;
}) {
  const [src] = createResource(
    () => props.media,
    (media) => props.urls.urlOf(media)
  );
  const start = (el: HTMLMediaElement) => {
    props.onElement(el);
    // This window never saw a click, so a browser may refuse sound.
    void el.play().catch(() => {
      el.muted = true;
      props.onMuted();
      void el.play().catch(() => {});
    });
  };
  onCleanup(() => props.onElement(undefined));
  return (
    <Show when={src()}>
      {(url) => (
        <Show
          when={props.media.kind === 'video'}
          fallback={
            <audio
              ref={(el) => queueMicrotask(() => start(el))}
              src={url()}
              data-testid="pptx-audience-media"
              onEnded={() => props.onEnded()}
            />
          }
        >
          <video
            ref={(el) => queueMicrotask(() => start(el))}
            src={url()}
            playsinline
            data-testid="pptx-audience-media"
            style={{
              ...boxStyle(props.box),
              'z-index': 1,
              'object-fit': 'contain',
              background: 'black',
            }}
            onEnded={() => props.onEnded()}
          />
        </Show>
      )}
    </Show>
  );
}

/**
 * A clip on the console's current slide: a Play button until it plays,
 * then (for a video) a silent mirror of the audience screen with Play /
 * Pause, Stop, the time, and a seek bar.
 */
export function ConsoleClip(props: {
  media: MediaOutline;
  box: MediaBox;
  urls: MediaUrls;
  playing: boolean;
  /** The audience window's copy, which the controls drive when present. */
  audience: HTMLMediaElement | undefined;
  /** Whether the audience copy had to play muted. */
  audienceMuted: boolean;
  onPlay: () => void;
  onStop: () => void;
}) {
  const [src] = createResource(
    () => (props.playing ? props.media : undefined),
    (media) => props.urls.urlOf(media)
  );
  const [local, setLocal] = createSignal<HTMLMediaElement>();
  const [paused, setPaused] = createSignal(false);
  const [time, setTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  /** The copy whose sound is heard and whose controls drive the clip. */
  const primary = () => props.audience ?? local();
  const mirrored = () => !!props.audience && props.audience !== local();

  // Follow the primary copy's playback (an external element's events).
  createEffect(() => {
    const el = primary();
    if (!el) return;
    const mirror = mirrored() ? local() : undefined;
    const sync = () => {
      setPaused(el.paused);
      setTime(el.currentTime);
      if (Number.isFinite(el.duration)) setDuration(el.duration);
      if (!mirror) return;
      if (Math.abs(mirror.currentTime - el.currentTime) > 0.3)
        mirror.currentTime = el.currentTime;
      if (el.paused && !mirror.paused) mirror.pause();
      else if (!el.paused && mirror.paused) void mirror.play().catch(() => {});
    };
    const events = [
      'play',
      'pause',
      'seeked',
      'timeupdate',
      'durationchange',
      'loadedmetadata',
    ];
    for (const e of events) el.addEventListener(e, sync);
    sync();
    onCleanup(() => {
      for (const e of events) el.removeEventListener(e, sync);
    });
  });

  const toggle = () => {
    const el = primary();
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };
  const stop = (e: Event) => e.stopPropagation();

  return (
    <Show
      when={props.playing}
      fallback={
        <button
          type="button"
          class="absolute z-10 flex size-8 items-center justify-center rounded-full bg-[black]/70 text-[white] shadow hover:bg-[black]/85"
          style={{
            left: `${props.box.x + 8}px`,
            top: `${Math.max(props.box.y, props.box.y + props.box.h - 40)}px`,
          }}
          aria-label={
            props.media.kind === 'video' ? 'Play video' : 'Play audio'
          }
          title={
            props.media.kind === 'video'
              ? 'Play on the audience screen'
              : 'Play audio'
          }
          data-testid="pptx-presenter-media-play"
          onClick={(e) => {
            e.stopPropagation();
            props.onPlay();
          }}
        >
          <Play class="size-4" />
        </button>
      }
    >
      <Show when={src()}>
        {(url) => (
          <Show
            when={props.media.kind === 'video'}
            fallback={
              <Show when={!props.audience}>
                <audio
                  ref={setLocal}
                  src={url()}
                  autoplay
                  onEnded={() => props.onStop()}
                />
              </Show>
            }
          >
            <video
              ref={setLocal}
              src={url()}
              autoplay
              playsinline
              muted={!!props.audience && !props.audienceMuted}
              class="absolute z-10 bg-[black] object-contain"
              style={boxStyle(props.box)}
              data-testid="pptx-presenter-media-video"
              onEnded={() => !props.audience && props.onStop()}
            />
          </Show>
        )}
      </Show>
      <div
        class="absolute z-10 flex items-center gap-1 rounded-md bg-[black]/75 px-1.5 py-1 text-[white] text-xs"
        style={{
          left: `${props.box.x}px`,
          top: `${props.box.y + props.box.h + 4}px`,
          width: `${Math.max(220, props.box.w)}px`,
        }}
        data-testid="pptx-presenter-media-controls"
        onPointerDown={stop}
        onClick={stop}
      >
        <button
          type="button"
          class="rounded p-1 hover:bg-[white]/20"
          aria-label={paused() ? 'Play' : 'Pause'}
          data-testid="pptx-presenter-media-toggle"
          onClick={toggle}
        >
          <Show when={paused()} fallback={<Pause class="size-3.5" />}>
            <Play class="size-3.5" />
          </Show>
        </button>
        <button
          type="button"
          class="rounded p-1 hover:bg-[white]/20"
          aria-label="Stop"
          data-testid="pptx-presenter-media-stop"
          onClick={() => props.onStop()}
        >
          <Stop class="size-3.5" />
        </button>
        <input
          type="range"
          class="min-w-0 flex-1 accent-[white]"
          min="0"
          max={duration() || 0}
          step="0.1"
          value={time()}
          aria-label="Seek"
          data-testid="pptx-presenter-media-seek"
          onInput={(e) => {
            const el = primary();
            if (el) el.currentTime = Number(e.currentTarget.value);
          }}
        />
        <span class="tabular-nums" data-testid="pptx-presenter-media-time">
          {formatTime(time())} / {formatTime(duration())}
        </span>
      </div>
    </Show>
  );
}
