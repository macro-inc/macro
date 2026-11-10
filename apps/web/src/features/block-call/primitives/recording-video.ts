import { isModality } from '@core/mobile/inputModality';
import { fireAndForget } from '@core/util/fireAndForget';
import { createEffect, createMemo, on, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { createRecordingControlsVisibility } from './recording-controls';
import type { RecordingPlayback } from './recording-playback';

type VideoState = {
  loadedRevision: number;
  errorRevision: number;
  posterRevision: number;
  posterBlobUrl: string | undefined;
};
type VideoEvent = Event & { currentTarget: HTMLVideoElement };

type RecordingVideoOptions = {
  url: string;
  posterUrl?: string;
  playback?: RecordingPlayback;
  onTimeUpdate?: (
    seconds: number,
    source: 'playback' | 'seeking' | 'seeked'
  ) => void;
  setVideoRef?: (element: HTMLVideoElement) => void;
};

/** Coordinate readiness, poster resources and media/input events for one mounted video. */
export function createRecordingVideo(options: RecordingVideoOptions) {
  const [state, setState] = createStore<VideoState>({
    loadedRevision: 0,
    errorRevision: 0,
    posterRevision: 0,
    posterBlobUrl: undefined,
  });
  const sourceRevision = createMemo<number>(
    on(
      () => options.url,
      (_url, _previousUrl, revision: number | undefined) => (revision ?? 0) + 1
    ),
    0
  );
  const posterRevision = createMemo<number>(
    on(
      () => options.posterUrl,
      (_url, _previousUrl, revision: number | undefined) => (revision ?? 0) + 1
    ),
    0
  );
  const isLoaded = () => state.loadedRevision === sourceRevision();
  const playbackError = () => state.errorRevision === sourceRevision();
  const posterBlobUrl = () =>
    state.posterRevision === posterRevision() ? state.posterBlobUrl : undefined;
  const controls = createRecordingControlsVisibility(
    () => options.playback?.paused() ?? true
  );
  let rafId: number | undefined;
  let video: HTMLVideoElement | undefined;
  let revealOnlyTap = false;

  createEffect(
    on(
      () => options.posterUrl,
      (url) => {
        if (!url) return;
        const revision = posterRevision();
        const controller = new AbortController();
        let objectUrl: string | undefined;
        onCleanup(() => {
          controller.abort();
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        });
        const loadPoster = async () => {
          try {
            const response = await fetch(url, {
              mode: 'cors',
              signal: controller.signal,
            });
            if (!response.ok)
              throw new Error(`Failed to fetch poster: ${response.status}`);
            const blob = await response.blob();
            if (controller.signal.aborted) return;
            objectUrl = URL.createObjectURL(blob);
            setState({ posterRevision: revision, posterBlobUrl: objectUrl });
          } catch (error) {
            if (!controller.signal.aborted)
              console.error(
                'Failed to load call recording preview poster',
                error
              );
          }
        };
        fireAndForget(loadPoster(), 'call-recording');
      }
    )
  );

  const stopTicking = () => {
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    rafId = undefined;
  };
  const startTicking = (element: HTMLVideoElement) => {
    stopTicking();
    const tick = () => {
      options.onTimeUpdate?.(element.currentTime, 'playback');
      rafId =
        !element.paused && !element.ended
          ? requestAnimationFrame(tick)
          : undefined;
    };
    rafId = requestAnimationFrame(tick);
  };
  const markReady = () =>
    setState({ loadedRevision: sourceRevision(), errorRevision: 0 });
  onMount(() => video?.load());
  onCleanup(stopTicking);

  return {
    controls,
    playbackError,
    posterBlobUrl,
    hasVisibleVideo: () => isLoaded() || !!posterBlobUrl() || playbackError(),
    setVideoRef: (element: HTMLVideoElement) => {
      video = element;
      options.setVideoRef?.(element);
    },
    surfaceEvents: {
      onPointerMove: (event: PointerEvent) => {
        controls.setHovered(
          event.pointerType !== 'touch' &&
            event.target instanceof Element &&
            event.target.closest('[data-recording-controls]') !== null
        );
        controls.show();
      },
      onPointerLeave: () => controls.setHovered(false),
      onPointerDown: () => {
        controls.setFocused(false);
        controls.show();
      },
      onFocusIn: () => {
        controls.setFocused(isModality('keyboard'));
        controls.show();
      },
      onKeyDown: () => controls.setFocused(true),
      onFocusOut: (event: FocusEvent) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !(event.currentTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          controls.setFocused(false);
      },
    },
    videoEvents: {
      onPointerDown: (event: PointerEvent) => {
        revealOnlyTap = event.pointerType === 'touch' && !controls.visible();
      },
      onClick: () => {
        if (!revealOnlyTap && !playbackError()) options.playback?.toggle();
        revealOnlyTap = false;
      },
      onError: () => {
        stopTicking();
        setState('errorRevision', sourceRevision());
      },
      onLoadedData: markReady,
      onCanPlay: markReady,
      onPlaying: (event: VideoEvent) => {
        markReady();
        startTicking(event.currentTarget);
      },
      onPlay: (event: VideoEvent) => startTicking(event.currentTarget),
      onPause: stopTicking,
      onSeeking: (event: VideoEvent) =>
        options.onTimeUpdate?.(event.currentTarget.currentTime, 'seeking'),
      onSeeked: (event: VideoEvent) =>
        options.onTimeUpdate?.(event.currentTarget.currentTime, 'seeked'),
      onEnded: (event: VideoEvent) => {
        stopTicking();
        options.onTimeUpdate?.(event.currentTarget.duration, 'playback');
      },
      onTimeUpdate: (event: VideoEvent) =>
        options.onTimeUpdate?.(event.currentTarget.currentTime, 'playback'),
      onLoadedMetadata: (event: VideoEvent) =>
        options.onTimeUpdate?.(event.currentTarget.currentTime, 'playback'),
    },
  };
}
