import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';

export type Point = { x: number; y: number };

/**
 * A walkthrough clock. Every frame of a scene is a pure function of `t`
 * (milliseconds), so reduced motion and a visitor's takeover can jump to the
 * finished document without replaying anything.
 */
export function createSceneClock(options: {
  root: () => HTMLElement;
  end: number;
  /** Wait before the first frame once the demo is on screen. */
  lead?: number;
  tick?: number;
}) {
  const tick = options.tick ?? 50;
  const [t, setT] = createSignal(0);
  const [live, setLive] = createSignal(true);
  const [reduced, setReduced] = createSignal(false);
  const finish = () => setT(options.end);
  const playback = createProductWalkthrough({
    root: options.root,
    steps: Math.ceil(options.end / tick),
    reset: () => {},
    reduced: () => {
      setReduced(true);
      setLive(false);
      finish();
    },
    delay: (step) => (step === 1 ? (options.lead ?? 600) : tick),
    advance: (step) => setT(Math.min(options.end, step * tick)),
  });
  return {
    t,
    /** False once the visitor takes over or motion is reduced. */
    live,
    reduced,
    done: () => t() >= options.end,
    /** The visitor's first interaction settles the scene, then stops it. */
    takeOver: () => {
      if (!live()) return;
      playback.pause();
      finish();
      setLive(false);
    },
  };
}

/** The visible part of `text` while it is typed between `from` and `to`. */
export function typed(text: string, t: number, from: number, to: number) {
  if (t <= from) return '';
  if (t >= to) return text;
  return text.slice(0, Math.round((text.length * (t - from)) / (to - from)));
}

/** Where the pointer tip rests on an insertion point or a control. */
export const caretPoint = (rect: DOMRect): Point => ({
  x: rect.left + 1,
  y: rect.top + rect.height * 0.72,
});
export const controlPoint = (rect: DOMRect): Point => ({
  x: rect.left + Math.min(rect.width / 2, 36),
  y: rect.top + rect.height / 2,
});

/**
 * Measures a target inside the demo window so a DemoCursor can follow it,
 * re-measuring whenever the scene changes, the window resizes or it scrolls.
 */
export function createAnchor(options: {
  frame: () => HTMLElement | undefined;
  target: () =>
    | { selector: string; place?: (rect: DOMRect) => Point }
    | undefined;
  /** Re-measure whenever this changes, e.g. the scene clock. */
  track?: () => unknown;
}) {
  const [point, setPoint] = createSignal<Point>();
  const measure = () => {
    options.track?.();
    const frame = options.frame();
    const target = options.target();
    const element = target
      ? frame?.querySelector<HTMLElement>(target.selector)
      : undefined;
    if (!frame || !target || !element) {
      setPoint(undefined);
      return;
    }
    const bounds = frame.getBoundingClientRect();
    const place = (target.place ?? caretPoint)(element.getBoundingClientRect());
    setPoint({ x: place.x - bounds.left, y: place.y - bounds.top });
  };
  createEffect(measure);
  onMount(() => {
    const frame = options.frame();
    if (!frame) return;
    const resize = new ResizeObserver(measure);
    resize.observe(frame);
    frame.addEventListener('scroll', measure, true);
    onCleanup(() => {
      resize.disconnect();
      frame.removeEventListener('scroll', measure, true);
    });
  });
  return point;
}
