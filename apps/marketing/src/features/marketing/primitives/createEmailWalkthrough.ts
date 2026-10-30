import { createSignal, onCleanup, onMount } from 'solid-js';
import { observeDemoTakeover } from './observeDemoTakeover';

export const DEMO_SEQUENCE_FINISHED = 'macro-demo-finished';
export const DEMO_SEQUENCE_RESET = 'macro-demo-reset';

/** Finite, visibility-aware playback for the isolated email feature demos. */
export function createEmailWalkthrough(options: {
  root: () => HTMLElement;
  steps: number;
  /** Wait until this share of a taller scene is visible before animating. */
  visibilityThreshold?: number;
  advance: (step: number) => void;
  reset: () => void;
  reduced: () => void;
  /** Milliseconds before the given step; defaults to 1400ms per step. */
  delay?: (step: number) => number;
  /** Only opt in when reset restores the complete scene, including menus. */
  loop?: { hold: number };
  /** Called once when the visitor takes control, including through a boundary. */
  onTakeover?: () => void;
}) {
  const [playing, setPlaying] = createSignal(true);
  const [reducedMotion, setReducedMotion] = createSignal(false);
  let step = 0;
  let visible = false;
  let takenOver = false;
  let remaining: number | undefined;
  let started = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = (preserve = false) => {
    if (preserve && timer !== undefined && remaining !== undefined)
      remaining = Math.max(0, remaining - (performance.now() - started));
    clearTimeout(timer);
    timer = undefined;
  };
  const pauseClock = () => {
    clear();
    setPlaying(false);
  };
  const pause = () => {
    if (takenOver) return;
    takenOver = true;
    pauseClock();
    options.onTakeover?.();
  };
  const schedule = () => {
    clear(true);
    if (
      !visible ||
      !playing() ||
      reducedMotion() ||
      document.hidden ||
      takenOver
    )
      return;
    remaining ??=
      step >= options.steps
        ? (options.loop?.hold ?? 5000)
        : (options.delay?.(step + 1) ?? 1400);
    started = performance.now();
    timer = setTimeout(() => {
      timer = undefined;
      remaining = undefined;
      if (step >= options.steps) {
        replay();
        return;
      }
      options.advance(++step);
      if (step >= options.steps) {
        options
          .root()
          .dispatchEvent(
            new CustomEvent(DEMO_SEQUENCE_FINISHED, { bubbles: true })
          );
      }
      if (step >= options.steps && !options.loop) pauseClock();
      else schedule();
    }, remaining);
  };
  const replay = () => {
    if (takenOver) return;
    clear();
    remaining = undefined;
    step = 0;
    options.reset();
    options
      .root()
      .dispatchEvent(new CustomEvent(DEMO_SEQUENCE_RESET, { bubbles: true }));
    if (reducedMotion()) {
      options.reduced();
      return;
    }
    setPlaying(true);
    schedule();
  };
  const toggle = () => {
    if (takenOver) return;
    if (playing()) pauseClock();
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
      if (media.matches && !takenOver) {
        pauseClock();
        options.reduced();
        options
          .root()
          .dispatchEvent(
            new CustomEvent(DEMO_SEQUENCE_FINISHED, { bubbles: true })
          );
      }
    };
    sync();
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible =
          entry.isIntersecting &&
          (entry.intersectionRatio ?? 1) >=
            (options.visibilityThreshold ?? 0.5);
        schedule();
      },
      { threshold: options.visibilityThreshold ?? 0.5 }
    );
    observer.observe(options.root());
    const root = options.root();
    const releaseTakeover = observeDemoTakeover(root, pause);
    media.addEventListener('change', sync);
    document.addEventListener('visibilitychange', schedule);
    onCleanup(() => {
      clear();
      observer.disconnect();
      releaseTakeover();
      media.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', schedule);
    });
  });
  return { playing, reducedMotion, pause, replay, toggle };
}
