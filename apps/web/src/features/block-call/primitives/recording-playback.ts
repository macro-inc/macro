import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

type RecordingPlaybackState = {
  time: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  rate: number;
  volume: number;
  isFullscreen: boolean;
  fullscreenSession: number;
};

export const RECORDING_PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;

/** One native media element remains the owner of playback across all controls. */
export function createRecordingPlayback(
  video: Accessor<HTMLVideoElement | undefined>,
  fullscreenTarget?: Accessor<HTMLElement | undefined>
) {
  const [state, setState] = createStore<RecordingPlaybackState>({
    time: 0,
    duration: 0,
    paused: true,
    muted: false,
    rate: 1,
    volume: 1,
    isFullscreen: false,
    fullscreenSession: 0,
  });
  const target = () => fullscreenTarget?.() ?? video()?.parentElement;
  createEffect(
    on(target, (element) => {
      const update = () => {
        const active = !!element && document.fullscreenElement === element;
        setState((previous) => ({
          isFullscreen: active,
          fullscreenSession:
            previous.fullscreenSession +
            Number(active && !previous.isFullscreen),
        }));
      };
      update();
      document.addEventListener('fullscreenchange', update);
      onCleanup(() => {
        document.removeEventListener('fullscreenchange', update);
        if (element && document.fullscreenElement === element)
          fireAndForget(document.exitFullscreen(), 'call-recording');
      });
    })
  );
  let audibleVolume = 1;
  createEffect(
    on(video, (element) => {
      if (!element) return;
      const update = () => {
        setState({
          time: Number.isFinite(element.currentTime) ? element.currentTime : 0,
          duration: Number.isFinite(element.duration) ? element.duration : 0,
          paused: element.paused,
          muted: element.muted,
          volume: element.volume,
          rate: element.playbackRate,
        });
        if (element.volume > 0) audibleVolume = element.volume;
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
    })
  );
  const seek = (seconds: number) => {
    const element = video();
    if (!element || !Number.isFinite(seconds)) return;
    const end = Number.isFinite(element.duration) ? element.duration : Infinity;
    element.currentTime = Math.max(0, Math.min(end, seconds));
    setState('time', element.currentTime);
  };
  return {
    time: () => state.time,
    duration: () => state.duration,
    paused: () => state.paused,
    muted: () => state.muted,
    rate: () => state.rate,
    volume: () => state.volume,
    isFullscreen: () => state.isFullscreen,
    fullscreenSession: () => state.fullscreenSession,
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
      setState({ volume: element.volume, muted: element.muted });
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
