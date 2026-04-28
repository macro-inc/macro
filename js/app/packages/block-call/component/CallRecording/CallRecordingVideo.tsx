import { createSignal, onCleanup } from 'solid-js';

export function CallRecordingVideo(props: {
  url: string;
  onTimeUpdate?: (
    seconds: number,
    source: 'playback' | 'seeking' | 'seeked'
  ) => void;
  setVideoRef?: (el: HTMLVideoElement) => void;
}) {
  const [isLoaded, setIsLoaded] = createSignal(false);
  let rafId: number | null = null;

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
  onCleanup(stopTicking);

  return (
    <div class="p-4 h-full min-h-0 flex justify-center items-start overflow-hidden">
      <video
        ref={props.setVideoRef}
        class="max-w-full max-h-full rounded transition-opacity duration-200"
        classList={{ 'opacity-0': !isLoaded(), 'opacity-100': isLoaded() }}
        controls
        crossorigin="anonymous"
        src={props.url}
        onLoadedData={() => setIsLoaded(true)}
        onCanPlay={() => setIsLoaded(true)}
        onPlaying={(event) => {
          setIsLoaded(true);
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
    </div>
  );
}
