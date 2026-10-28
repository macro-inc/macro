import { createSignal } from 'solid-js';
import { createDemoPointer } from '../../primitives/createDemoPointer';
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
  visibilityThreshold?: number;
}) {
  const tick = options.tick ?? 50;
  const [t, setT] = createSignal(0);
  const [live, setLive] = createSignal(true);
  const [reduced, setReduced] = createSignal(false);
  const finish = () => setT(options.end);
  const playback = createProductWalkthrough({
    root: options.root,
    visibilityThreshold: options.visibilityThreshold,
    steps: Math.ceil(options.end / tick),
    loop: { hold: 8000 },
    reset: () => {
      setT(0);
      setLive(true);
    },
    onTakeover: () => setLive(false),
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
    /** Stop in place before a visitor edits the current content. */
    pause: () => {
      playback.pause();
      setLive(false);
    },
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
  return createDemoPointer({
    frame: options.frame,
    target: () => options.target()?.selector,
    track: options.track,
    place: (rect) => (options.target()?.place ?? caretPoint)(rect),
  });
}
