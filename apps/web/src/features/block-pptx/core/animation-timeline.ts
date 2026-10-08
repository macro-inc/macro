/**
 * How a slide's animations play in a slide show: the slide split into
 * z-ordered layers (static runs of shapes, and each animated shape on its
 * own), the pieces that move (whole shapes, or paragraphs of a paragraph
 * build), the click steps with each animation's start time, and what every
 * piece looks like after a number of steps.
 */

import type {
  AnimationOutline,
  ShapeOutline,
  SlideOutline,
} from '@core/pptx-engine/types';
import type { Rect } from './selection';

/** A run of top-level shapes drawn as one image (`renderSpan`). */
export interface LayerSpec {
  /** Z-order positions `start..end` of the slide's top-level shapes. */
  start: number;
  end: number;
  /** Whether the background and layout/master shapes are drawn beneath. */
  backdrop: boolean;
  /** The animated top-level shape this layer holds, if any. */
  shapeId?: number;
}

/** Something that animates: a layer, or part of one. */
export interface Piece {
  key: string;
  /** Index into `layers`. */
  layer: number;
  /** The top-level shape. */
  shapeId: number;
  /** The paragraph, for a paragraph build. */
  paragraph?: number;
  /** Its box on the slide, in points (effects move and clip it). */
  box: Rect;
  /**
   * How the layer is clipped for this piece: to `box` (a paragraph), or to
   * everything outside these paragraph boxes (the rest of a built shape).
   */
  clip?: { kind: 'box' } | { kind: 'outside'; boxes: Rect[] };
}

export interface TimedAnimation {
  /** Playback position on the slide. */
  index: number;
  animation: AnimationOutline;
  piece: string;
  /** Milliseconds after the step starts. */
  start: number;
  /** One play, in milliseconds. */
  duration: number;
  /** Plays in all (`Infinity` = until the next click or the slide's end). */
  iterations: number;
}

export interface Timeline {
  layers: LayerSpec[];
  pieces: Piece[];
  /**
   * Animation groups: the first plays as the slide appears (animations
   * before the first click), then one per click.
   */
  groups: TimedAnimation[][];
}

/** What a piece looks like between animations. */
export interface PieceState {
  visible: boolean;
  /** Offset in points (motion paths). */
  dx: number;
  dy: number;
  /** Lasting scale (grow/shrink). */
  scale: number;
  opacity: number;
  /** Lasting CSS filter (desaturate, darken, lighten), or ''. */
  filter: string;
}

const boxOf = (s: ShapeOutline): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.h });

/** Whether `s` is shape `id` or a group holding it. */
function holds(s: ShapeOutline, id: number): boolean {
  return s.id === id || (s.children ?? []).some((c) => holds(c, id));
}

/** The animations with a target on the slide, in playback order. */
function playable(slide: SlideOutline): AnimationOutline[] {
  return (slide.animations ?? []).filter(
    (a) =>
      a.class !== 'media' &&
      a.class !== 'other' &&
      slide.shapes.some((s) => holds(s, a.shapeId))
  );
}

/**
 * The slide's layers, pieces, and timed groups. `paragraphBoxes` gives the
 * slide-space box of each paragraph of shapes with paragraph builds; a
 * shape without boxes animates whole.
 */
export function buildTimeline(
  slide: SlideOutline,
  paragraphBoxes: ReadonlyMap<number, Rect[]> = new Map()
): Timeline {
  const animations = playable(slide);
  const topOf = (id: number) => slide.shapes.findIndex((s) => holds(s, id));
  const animatedTop = new Set(animations.map((a) => topOf(a.shapeId)));

  const layers: LayerSpec[] = [];
  const pieces: Piece[] = [];
  const pieceFor = new Map<string, string>();
  let runStart = 0;
  const flush = (end: number) => {
    if (end > runStart || layers.length === 0)
      layers.push({ start: runStart, end, backdrop: layers.length === 0 });
  };
  slide.shapes.forEach((shape, i) => {
    if (!animatedTop.has(i)) return;
    flush(i);
    runStart = i + 1;
    const layer = layers.length;
    layers.push({ start: i, end: i + 1, backdrop: false, shapeId: shape.id });
    const own = animations.filter((a) => topOf(a.shapeId) === i);
    const boxes = paragraphBoxes.get(shape.id);
    const byParagraph =
      boxes !== undefined &&
      own.every((a) => a.shapeId === shape.id && a.paragraph !== undefined);
    if (byParagraph) {
      const built = [...new Set(own.map((a) => a.paragraph ?? 0))].filter(
        (p) => boxes[p] !== undefined
      );
      for (const p of built) {
        const key = `${shape.id}:${p}`;
        pieces.push({
          key,
          layer,
          shapeId: shape.id,
          paragraph: p,
          box: boxes[p],
          clip: { kind: 'box' },
        });
        pieceFor.set(`${shape.id}:${p}`, key);
      }
      pieces.push({
        key: `${shape.id}:rest`,
        layer,
        shapeId: shape.id,
        box: boxOf(shape),
        clip: { kind: 'outside', boxes: built.map((p) => boxes[p]) },
      });
    } else {
      const key = `${shape.id}`;
      pieces.push({ key, layer, shapeId: shape.id, box: boxOf(shape) });
      for (const a of own) pieceFor.set(`${a.shapeId}:${a.paragraph}`, key);
    }
  });
  flush(slide.shapes.length);

  const groups: TimedAnimation[][] = [[]];
  let parStart = 0;
  let parEnd = 0;
  animations.forEach((animation, index) => {
    const piece = pieceFor.get(`${animation.shapeId}:${animation.paragraph}`);
    if (!piece) return;
    const duration = Math.max(0, animation.durationMs);
    const repeat = animation.repeat ?? 1;
    const iterations = typeof repeat === 'number' ? repeat : Infinity;
    const length = duration * (Number.isFinite(iterations) ? iterations : 1);
    let start: number;
    if (animation.start === 'onClick') {
      groups.push([]);
      parStart = 0;
      start = animation.delayMs;
      parEnd = start + length;
    } else if (animation.start === 'withPrevious') {
      start = parStart + animation.delayMs;
      parEnd = Math.max(parEnd, start + length);
    } else {
      parStart = parEnd;
      start = parStart + animation.delayMs;
      parEnd = start + length;
    }
    groups[groups.length - 1].push({
      index,
      animation,
      piece,
      start,
      duration,
      iterations,
    });
  });
  return { layers, pieces, groups };
}

/** Clicks the slide takes before the next one. */
export const clickSteps = (t: Timeline) => t.groups.length - 1;

/** How long a group plays, in milliseconds (endless repeats count once). */
export function groupLength(group: TimedAnimation[]): number {
  return group.reduce(
    (end, a) =>
      Math.max(
        end,
        a.start +
          a.duration * (Number.isFinite(a.iterations) ? a.iterations : 1)
      ),
    0
  );
}

const PERSISTENT_FILTERS: Record<string, string> = {
  desaturate: 'grayscale(1)',
  darken: 'brightness(0.6)',
  lighten: 'brightness(1.4)',
};

/** Where a motion path ends, as a fraction of the slide. */
export function pathEnd(path: string | undefined): { x: number; y: number } {
  const nums = (path ?? '').match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  if (nums.length < 2) return { x: 0, y: 0 };
  return {
    x: Number(nums[nums.length - 2]),
    y: Number(nums[nums.length - 1]),
  };
}

/** The end of a straight path option, as a fraction of the slide. */
export function directionPath(direction: string | undefined): string {
  const d = 0.25;
  switch (direction) {
    case 'left':
      return `M 0 0 L ${-d} 0 E`;
    case 'right':
      return `M 0 0 L ${d} 0 E`;
    case 'up':
      return `M 0 0 L 0 ${-d} E`;
    default:
      return `M 0 0 L 0 ${d} E`;
  }
}

/** Applies one animation's lasting result to a piece's state. */
export function settle(
  state: PieceState,
  a: AnimationOutline,
  slide: { w: number; h: number }
): PieceState {
  switch (a.class) {
    case 'entrance':
      return { ...state, visible: true };
    case 'exit':
      return { ...state, visible: false };
    case 'path': {
      const end = pathEnd(a.path ?? directionPath(a.direction));
      return {
        ...state,
        dx: state.dx + end.x * slide.w,
        dy: state.dy + end.y * slide.h,
      };
    }
    default:
      if (a.effect === 'growShrink')
        return { ...state, scale: state.scale * 1.5 };
      if (a.effect === 'transparency') return { ...state, opacity: 0.5 };
      if (a.effect in PERSISTENT_FILTERS)
        return { ...state, filter: PERSISTENT_FILTERS[a.effect] };
      return state;
  }
}

/** Every piece's state once the first `steps + 1` groups have played. */
export function statesAfter(
  timeline: Timeline,
  steps: number,
  slide: { w: number; h: number }
): Map<string, PieceState> {
  const states = new Map<string, PieceState>();
  for (const piece of timeline.pieces) {
    const first = timeline.groups
      .flat()
      .find((a) => a.piece === piece.key)?.animation;
    states.set(piece.key, {
      visible: first?.class !== 'entrance',
      dx: 0,
      dy: 0,
      scale: 1,
      opacity: 1,
      filter: '',
    });
  }
  for (const group of timeline.groups.slice(0, steps + 1))
    for (const a of group) {
      const state = states.get(a.piece);
      if (state) states.set(a.piece, settle(state, a.animation, slide));
    }
  return states;
}
