import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

export const RECORDING_PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;

/** One native media element remains the owner of playback across all controls. */
export function createRecordingPlayback(
  video: Accessor<HTMLVideoElement | undefined>,
  fullscreenTarget?: Accessor<HTMLElement | undefined>
) {
  const [time, setTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [paused, setPaused] = createSignal(true);
  const [muted, setMuted] = createSignal(false);
  const [rate, setRate] = createSignal(1);
  const [volume, setVolumeLevel] = createSignal(1);
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const target = () => fullscreenTarget?.() ?? video()?.parentElement;
  createEffect(() => {
    const element = target();
    const update = () =>
      setIsFullscreen(!!element && document.fullscreenElement === element);
    update();
    document.addEventListener('fullscreenchange', update);
    onCleanup(() => {
      document.removeEventListener('fullscreenchange', update);
      if (element && document.fullscreenElement === element)
        fireAndForget(document.exitFullscreen(), 'call-recording');
    });
  });
  let audibleVolume = 1;
  createEffect(() => {
    const element = video();
    if (!element) return;
    const update = () => {
      setTime(Number.isFinite(element.currentTime) ? element.currentTime : 0);
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      setPaused(element.paused);
      setMuted(element.muted);
      setVolumeLevel(element.volume);
      if (element.volume > 0) audibleVolume = element.volume;
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
    volume,
    isFullscreen,
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
      if (!element) return;
      if (element.muted || element.volume === 0) {
        element.muted = false;
        if (element.volume === 0) element.volume = audibleVolume;
      } else {
        element.muted = true;
      }
    },
    setVolume: (value: number) => {
      const element = video();
      if (!element || !Number.isFinite(value)) return;
      element.volume = Math.max(0, Math.min(1, value));
      if (element.volume > 0) {
        audibleVolume = element.volume;
        element.muted = false;
      }
      // Controlled sliders read back during the same pointer event, before the
      // browser dispatches volumechange.
      setVolumeLevel(element.volume);
      setMuted(element.muted);
    },
    setRate: (value: number) => {
      const element = video();
      if (!element || !RECORDING_PLAYBACK_RATES.some((rate) => rate === value))
        return;
      element.playbackRate = value;
    },
    fullscreen: () => {
      const element = video();
      if (!element) return;
      if (document.fullscreenElement) {
        fireAndForget(document.exitFullscreen(), 'call-recording');
      } else if (target()?.requestFullscreen) {
        fireAndForget(target()!.requestFullscreen(), 'call-recording');
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
