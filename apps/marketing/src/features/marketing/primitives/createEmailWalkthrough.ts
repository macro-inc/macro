import { createSignal, onCleanup, onMount } from 'solid-js';

/** Finite, visibility-aware playback for the isolated email feature demos. */
export function createEmailWalkthrough(options: {
  root: () => HTMLElement;
  steps: number;
  advance: (step: number) => void;
  reset: () => void;
  reduced: () => void;
  /** Milliseconds before the given step; defaults to 1400ms per step. */
  delay?: (step: number) => number;
}) {
  const [playing, setPlaying] = createSignal(true);
  const [reducedMotion, setReducedMotion] = createSignal(false);
  let step = 0;
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const pause = () => {
    clear();
    setPlaying(false);
  };
  const schedule = () => {
    clear();
    if (!visible || !playing() || reducedMotion() || document.hidden) return;
    timer = setTimeout(
      () => {
        options.advance(++step);
        if (step >= options.steps) pause();
        else schedule();
      },
      options.delay?.(step + 1) ?? 1400
    );
  };
  const replay = () => {
    step = 0;
    options.reset();
    if (reducedMotion()) {
      options.reduced();
      return;
    }
    setPlaying(true);
    schedule();
  };
  const toggle = () => {
    if (playing()) pause();
    else if (step >= options.steps) replay();
    else {
      setPlaying(true);
      schedule();
    }
  };
  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReducedMotion(media.matches);
      if (media.matches) {
        pause();
        options.reduced();
      }
    };
    sync();
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        schedule();
      },
      { threshold: 0.25 }
    );
    observer.observe(options.root());
    media.addEventListener('change', sync);
    document.addEventListener('visibilitychange', schedule);
    onCleanup(() => {
      clear();
      observer.disconnect();
      media.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', schedule);
    });
  });
  return { playing, reducedMotion, pause, replay, toggle };
}
