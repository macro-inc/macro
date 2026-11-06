import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** One native media element remains the owner of playback across all controls. */
export function createRecordingPlayback(
  video: Accessor<HTMLVideoElement | undefined>
) {
  const [time, setTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [paused, setPaused] = createSignal(true);
  const [muted, setMuted] = createSignal(false);
  const [rate, setRate] = createSignal(1);
  createEffect(() => {
    const element = video();
    if (!element) return;
    const update = () => {
      setTime(Number.isFinite(element.currentTime) ? element.currentTime : 0);
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      setPaused(element.paused);
      setMuted(element.muted);
      setRate(element.playbackRate);
    };
    const events = [
      'timeupdate',
      'durationchange',
      'loadedmetadata',
      'play',
      'pause',
      'ended',
      'volumechange',
      'ratechange',
      'seeking',
      'emptied',
    ];
    for (const event of events) element.addEventListener(event, update);
    update();
    onCleanup(() => {
      for (const event of events) element.removeEventListener(event, update);
    });
  });
  const seek = (seconds: number) => {
    const element = video();
    if (!element || !Number.isFinite(seconds)) return;
    const end = Number.isFinite(element.duration) ? element.duration : Infinity;
    element.currentTime = Math.max(0, Math.min(end, seconds));
    setTime(element.currentTime);
  };
  return {
    time,
    duration,
    paused,
    muted,
    rate,
    seek,
    toggle: () => {
      const element = video();
      if (!element) return;
      if (element.paused) fireAndForget(element.play(), 'call-recording');
      else element.pause();
    },
    skip: (seconds: number) => seek((video()?.currentTime ?? 0) + seconds),
    toggleMute: () => {
      const element = video();
      if (element) element.muted = !element.muted;
    },
    cycleRate: () => {
      const element = video();
      if (!element) return;
      const rates = [1, 1.25, 1.5, 1.75, 2];
      element.playbackRate =
        rates[(rates.indexOf(element.playbackRate) + 1) % rates.length];
    },
    fullscreen: () => {
      const element = video();
      if (!element) return;
      if (document.fullscreenElement) {
        fireAndForget(document.exitFullscreen(), 'call-recording');
      } else if (element.parentElement?.requestFullscreen) {
        fireAndForget(
          element.parentElement.requestFullscreen(),
          'call-recording'
        );
      } else if (
        'webkitEnterFullscreen' in element &&
        typeof element.webkitEnterFullscreen === 'function'
      ) {
        element.webkitEnterFullscreen();
      }
    },
  };
}

export type RecordingPlayback = ReturnType<typeof createRecordingPlayback>;
