/**
 * PowerPoint's animation galleries: the effects the engine writes, with
 * their names and effect options, and how outlines turn back into
 * `setAnimations` specs.
 */

import type {
  AnimationClass,
  AnimationOutline,
  AnimationSpec,
} from '@core/pptx-engine/types';

export interface EffectOption {
  value: string;
  label: string;
}

export interface EffectInfo {
  class: AnimationClass;
  effect: string;
  label: string;
  /** Effect options; the first is the default. */
  options?: EffectOption[];
}

const opts = (...pairs: [string, string][]): EffectOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

const EDGES = opts(
  ['bottom', 'From Bottom'],
  ['bottomLeft', 'From Bottom-Left'],
  ['left', 'From Left'],
  ['topLeft', 'From Top-Left'],
  ['top', 'From Top'],
  ['topRight', 'From Top-Right'],
  ['right', 'From Right'],
  ['bottomRight', 'From Bottom-Right']
);
const EXIT_EDGES = EDGES.map((o) => ({
  ...o,
  label: o.label.replace('From', 'To'),
}));
const WIPE = opts(
  ['bottom', 'From Bottom'],
  ['left', 'From Left'],
  ['right', 'From Right'],
  ['top', 'From Top']
);
const SPLIT = opts(
  ['verticalOut', 'Vertical Out'],
  ['horizontalOut', 'Horizontal Out'],
  ['verticalIn', 'Vertical In'],
  ['horizontalIn', 'Horizontal In']
);
const SHAPES = opts(
  ['circleOut', 'Circle Out'],
  ['circleIn', 'Circle In'],
  ['boxOut', 'Box Out'],
  ['boxIn', 'Box In'],
  ['diamondOut', 'Diamond Out'],
  ['diamondIn', 'Diamond In'],
  ['plusOut', 'Plus Out'],
  ['plusIn', 'Plus In']
);
const WHEEL = opts(
  ['spokes1', '1 Spoke'],
  ['spokes2', '2 Spokes'],
  ['spokes3', '3 Spokes'],
  ['spokes4', '4 Spokes'],
  ['spokes8', '8 Spokes']
);
const BARS = opts(['horizontal', 'Horizontal'], ['vertical', 'Vertical']);
const ZOOM = opts(
  ['objectCenter', 'Object Center'],
  ['slideCenter', 'Slide Center']
);

export const EFFECTS: EffectInfo[] = [
  { class: 'entrance', effect: 'appear', label: 'Appear' },
  { class: 'entrance', effect: 'fade', label: 'Fade' },
  { class: 'entrance', effect: 'flyIn', label: 'Fly In', options: EDGES },
  {
    class: 'entrance',
    effect: 'floatIn',
    label: 'Float In',
    options: opts(['up', 'Float Up'], ['down', 'Float Down']),
  },
  { class: 'entrance', effect: 'split', label: 'Split', options: SPLIT },
  { class: 'entrance', effect: 'wipe', label: 'Wipe', options: WIPE },
  { class: 'entrance', effect: 'shape', label: 'Shape', options: SHAPES },
  { class: 'entrance', effect: 'wheel', label: 'Wheel', options: WHEEL },
  {
    class: 'entrance',
    effect: 'randomBars',
    label: 'Random Bars',
    options: BARS,
  },
  { class: 'entrance', effect: 'growTurn', label: 'Grow & Turn' },
  { class: 'entrance', effect: 'zoom', label: 'Zoom', options: ZOOM },
  { class: 'entrance', effect: 'swivel', label: 'Swivel' },
  { class: 'entrance', effect: 'bounce', label: 'Bounce' },
  { class: 'emphasis', effect: 'pulse', label: 'Pulse' },
  { class: 'emphasis', effect: 'colorPulse', label: 'Color Pulse' },
  { class: 'emphasis', effect: 'teeter', label: 'Teeter' },
  {
    class: 'emphasis',
    effect: 'spin',
    label: 'Spin',
    options: opts(
      ['clockwise', 'Clockwise'],
      ['counterclockwise', 'Counterclockwise']
    ),
  },
  { class: 'emphasis', effect: 'growShrink', label: 'Grow/Shrink' },
  { class: 'emphasis', effect: 'desaturate', label: 'Desaturate' },
  { class: 'emphasis', effect: 'darken', label: 'Darken' },
  { class: 'emphasis', effect: 'lighten', label: 'Lighten' },
  { class: 'emphasis', effect: 'transparency', label: 'Transparency' },
  { class: 'emphasis', effect: 'boldFlash', label: 'Bold Flash' },
  { class: 'emphasis', effect: 'wave', label: 'Wave' },
  { class: 'exit', effect: 'disappear', label: 'Disappear' },
  { class: 'exit', effect: 'fadeOut', label: 'Fade' },
  { class: 'exit', effect: 'flyOut', label: 'Fly Out', options: EXIT_EDGES },
  {
    class: 'exit',
    effect: 'floatOut',
    label: 'Float Out',
    options: opts(['down', 'Float Down'], ['up', 'Float Up']),
  },
  {
    class: 'exit',
    effect: 'split',
    label: 'Split',
    options: [SPLIT[2], SPLIT[3], SPLIT[0], SPLIT[1]],
  },
  { class: 'exit', effect: 'wipe', label: 'Wipe', options: WIPE },
  {
    class: 'exit',
    effect: 'shape',
    label: 'Shape',
    options: [SHAPES[1], SHAPES[0], ...SHAPES.slice(2)],
  },
  { class: 'exit', effect: 'wheel', label: 'Wheel', options: WHEEL },
  { class: 'exit', effect: 'randomBars', label: 'Random Bars', options: BARS },
  { class: 'exit', effect: 'shrinkTurn', label: 'Shrink & Turn' },
  { class: 'exit', effect: 'zoom', label: 'Zoom', options: ZOOM },
  { class: 'exit', effect: 'swivel', label: 'Swivel' },
  { class: 'exit', effect: 'bounce', label: 'Bounce' },
  {
    class: 'path',
    effect: 'path',
    label: 'Lines',
    options: opts(
      ['down', 'Down'],
      ['left', 'Left'],
      ['right', 'Right'],
      ['up', 'Up']
    ),
  },
];

export const CLASS_LABELS: Record<string, string> = {
  entrance: 'Entrance',
  emphasis: 'Emphasis',
  exit: 'Exit',
  path: 'Motion Paths',
};

/** The gallery entry of an animation, if the engine writes it. */
export function effectInfo(
  cls: string,
  effect: string
): EffectInfo | undefined {
  return EFFECTS.find((e) => e.class === cls && e.effect === effect);
}

/** A readable name for any animation, gallery or not. */
export function effectLabel(a: Pick<AnimationOutline, 'class' | 'effect'>) {
  return (
    effectInfo(a.class, a.effect)?.label ??
    a.effect
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/** An outline animation as a spec that keeps it as it is. */
export function specOf(a: AnimationOutline): AnimationSpec {
  return {
    shapeId: a.shapeId,
    class: a.class,
    effect: a.effect,
    start: a.start,
    durationMs: a.durationMs > 0 ? a.durationMs : undefined,
    delayMs: a.delayMs,
    direction: a.direction,
    paragraph: a.paragraph,
    repeat: a.repeat,
    path: a.path,
  };
}

/**
 * The click step numbers PowerPoint shows beside each animation: the
 * number of the click that starts it (0 for ones playing as the slide
 * appears).
 */
export function clickNumbers(animations: AnimationOutline[]): number[] {
  let click = 0;
  return animations.map((a) => {
    if (a.start === 'onClick') click++;
    return click;
  });
}
