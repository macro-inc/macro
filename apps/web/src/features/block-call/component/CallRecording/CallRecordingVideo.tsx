import type { JSX } from 'solid-js';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';

export function CallRecordingVideo(props: {
  url: string;
  posterUrl?: string;
  onTimeUpdate?: (
    seconds: number,
    source: 'playback' | 'seeking' | 'seeked'
  ) => void;
  setVideoRef?: (el: HTMLVideoElement) => void;
}): JSX.Element {
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [playbackError, setPlaybackError] = createSignal(false);
  const [posterBlobUrl, setPosterBlobUrl] = createSignal<string>();
  const hasVisibleVideo = () =>
    isLoaded() || !!posterBlobUrl() || playbackError();
  let rafId: number | null = null;

  createEffect<string | undefined>((previousUrl) => {
    const url = props.url;
    if (url !== previousUrl) {
      setIsLoaded(false);
      setPlaybackError(false);
    }
    return url;
  });

  createEffect(() => {
    const posterUrl = props.posterUrl;
    setPosterBlobUrl(undefined);
    if (!posterUrl) return;

    const abortController = new AbortController();
    let objectUrl: string | undefined;

    onCleanup(() => {
      abortController.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });

    void (async () => {
      try {
        const response = await fetch(posterUrl, {
          mode: 'cors',
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch poster: ${response.status}`);
        }

        const blob = await response.blob();
        if (abortController.signal.aborted) return;

        objectUrl = URL.createObjectURL(blob);
        setPosterBlobUrl(objectUrl);
      } catch (error) {
        if (abortController.signal.aborted) return;
        console.error('Failed to load call recording preview poster', error);
      }
    })();
  });

  const stopTicking = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const startTicking = (video: HTMLVideoElement) => {
    stopTicking();
    const tick = () => {
      props.onTimeUpdate?.(video.currentTime, 'playback');
      if (!video.paused && !video.ended) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
  };

  function markPlaybackReady(): void {
    setIsLoaded(true);
    setPlaybackError(false);
  }

  function handlePlaybackError(): void {
    stopTicking();
    setPlaybackError(true);
  }

  onCleanup(stopTicking);

  return (
    <div class="p-4 flex flex-col justify-center items-center gap-3 overflow-hidden">
      <video
        ref={props.setVideoRef}
        class="max-w-full max-h-full rounded transition-opacity duration-200"
        classList={{
          'opacity-0': !hasVisibleVideo(),
          'opacity-100': hasVisibleVideo(),
        }}
        controls
        crossorigin="anonymous"
        poster={posterBlobUrl()}
        src={props.url}
        onError={handlePlaybackError}
        onLoadedData={markPlaybackReady}
        onCanPlay={markPlaybackReady}
        onPlaying={(event) => {
          markPlaybackReady();
          startTicking(event.currentTarget);
        }}
        onPlay={(event) => startTicking(event.currentTarget)}
        onPause={() => stopTicking()}
        onSeeking={(event) =>
          props.onTimeUpdate?.(event.currentTarget.currentTime, 'seeking')
        }
        onSeeked={(event) =>
          props.onTimeUpdate?.(event.currentTarget.currentTime, 'seeked')
        }
        onEnded={(event) => {
          stopTicking();
          props.onTimeUpdate?.(event.currentTarget.duration, 'playback');
        }}
        onTimeUpdate={(event) =>
          props.onTimeUpdate?.(event.currentTarget.currentTime, 'playback')
        }
        onLoadedMetadata={(event) =>
          props.onTimeUpdate?.(event.currentTarget.currentTime, 'playback')
        }
      />
      <Show when={playbackError()}>
        <div
          role="alert"
          class="w-full max-w-lg rounded border border-alert/30 bg-alert-bg px-3 py-2 text-sm text-alert-ink"
        >
          <p class="font-medium">
            This recording uses a media format your browser can't play.
          </p>
          <p class="mt-1 text-alert-ink/80">
            You can still open or download the recording to play it in another
            app.
          </p>
          <a
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
            download=""
            class="mt-2 inline-flex font-medium text-alert-ink underline underline-offset-2 hover:text-alert-ink/80"
          >
            Open or download recording
          </a>
        </div>
      </Show>
    </div>
  );
}
