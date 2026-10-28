/**
 * Keyframes (Web Animations) for PowerPoint's animation effects, played on
 * a piece of a slide drawn on a slide-sized canvas. Lengths are in CSS
 * pixels: `k` pixels per point.
 */

import type { AnimationOutline } from '@core/pptx-engine/types';
import {
  directionPath,
  type Piece,
  type PieceState,
} from './animation-timeline';
import type { Rect } from './selection';

export interface EffectFrames {
  keyframes: Keyframe[];
  easing: string;
}

interface Frame {
  /** Extra transform between the lasting offset and scale. */
  transform?: string;
  opacity?: number;
  /** Extra filter after the lasting one. */
  filter?: string;
  clipPath?: string;
  offset?: number;
}

/** CSS `inset()` clipping a slide-sized element to `r`. */
export function insetOf(
  r: Rect,
  slide: { w: number; h: number },
  k: number
): string {
  const px = (v: number) => `${(v * k).toFixed(2)}px`;
  return `inset(${px(r.y)} ${px(slide.w - r.x - r.w)} ${px(slide.h - r.y - r.h)} ${px(r.x)})`;
}

/** CSS clip-path for a piece at rest. */
export function restingClip(
  piece: Piece,
  slide: { w: number; h: number },
  k: number
): string | undefined {
  const clip = piece.clip;
  if (!clip) return undefined;
  if (clip.kind === 'box') return insetOf(piece.box, slide, k);
  // Everything but the built paragraphs: the slide with holes (even-odd).
  const rect = (r: Rect) => {
    const [x0, y0, x1, y1] = [r.x, r.y, r.x + r.w, r.y + r.h].map((v) =>
      (v * k).toFixed(2)
    );
    return `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
  };
  const all = rect({ x: -10_000, y: -10_000, w: 20_000, h: 20_000 });
  return `path(evenodd, "${all}${clip.boxes.map(rect).join('')}")`;
}

/** Polyline points of a motion path, as fractions of the slide. */
export function pathPoints(path: string): { x: number; y: number }[] {
  const tokens = path.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const points: { x: number; y: number }[] = [];
  let at = { x: 0, y: 0 };
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++].toUpperCase();
    if (cmd === 'M' || cmd === 'L') {
      at = { x: num(), y: num() };
      points.push(at);
    } else if (cmd === 'C') {
      const [c1, c2, end] = [
        { x: num(), y: num() },
        { x: num(), y: num() },
        { x: num(), y: num() },
      ];
      const from = at;
      for (let s = 1; s <= 12; s++) {
        const t = s / 12;
        const u = 1 - t;
        points.push({
          x:
            u * u * u * from.x +
            3 * u * u * t * c1.x +
            3 * u * t * t * c2.x +
            t * t * t * end.x,
          y:
            u * u * u * from.y +
            3 * u * u * t * c1.y +
            3 * u * t * t * c2.y +
            t * t * t * end.y,
        });
      }
      at = end;
    } else if (cmd === 'Z' && points.length > 0) {
      at = points[0];
      points.push(at);
    }
  }
  return points.length > 0 ? points : [{ x: 0, y: 0 }];
}

/** How far a fly effect starts (or ends) off its place, in points. */
function flyOffset(
  direction: string | undefined,
  box: Rect,
  slide: { w: number; h: number }
) {
  const d = direction ?? 'bottom';
  const dx =
    d.includes('Left') || d === 'left'
      ? -(box.x + box.w)
      : d.includes('Right') || d === 'right'
        ? slide.w - box.x
        : 0;
  const dy = d.startsWith('bottom')
    ? slide.h - box.y
    : d.startsWith('top')
      ? -(box.y + box.h)
      : 0;
  return { dx, dy };
}

/** Clip frames that reveal `box` (entrance; reversed for exits). */
function revealClips(
  effect: string,
  direction: string | undefined,
  box: Rect,
  slide: { w: number; h: number },
  k: number
): string[] | undefined {
  const full = insetOf(box, slide, k);
  const collapsed = (r: Rect) => insetOf(r, slide, k);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const px = (v: number) => `${(v * k).toFixed(2)}px`;
  switch (effect) {
    case 'wipe': {
      const d = direction ?? 'bottom';
      const start =
        d === 'left'
          ? { ...box, w: 0 }
          : d === 'right'
            ? { ...box, x: box.x + box.w, w: 0 }
            : d === 'top'
              ? { ...box, h: 0 }
              : { ...box, y: box.y + box.h, h: 0 };
      return [collapsed(start), full];
    }
    case 'split': {
      const vertical = (direction ?? 'verticalOut').startsWith('vertical');
      const start = vertical
        ? { ...box, x: cx, w: 0 }
        : { ...box, y: cy, h: 0 };
      return [collapsed(start), full];
    }
    case 'shape': {
      const r = Math.hypot(box.w, box.h) / 2;
      const d = direction ?? 'circleOut';
      if (d.startsWith('box') || d.startsWith('plus'))
        return [collapsed({ x: cx, y: cy, w: 0, h: 0 }), full];
      if (d.startsWith('diamond')) {
        const at = (s: number) =>
          `polygon(${px(cx)} ${px(cy - s)}, ${px(cx + s)} ${px(cy)}, ${px(cx)} ${px(cy + s)}, ${px(cx - s)} ${px(cy)})`;
        return [at(0), at(box.w / 2 + box.h / 2)];
      }
      return [
        `circle(0px at ${px(cx)} ${px(cy)})`,
        `circle(${px(r)} at ${px(cx)} ${px(cy)})`,
      ];
    }
    case 'wheel': {
      const r = Math.hypot(box.w, box.h);
      const frames: string[] = [];
      for (let step = 0; step <= 8; step++) {
        const sweep = (step / 8) * Math.PI * 2;
        const pts = [`${px(cx)} ${px(cy)}`];
        for (let j = 0; j <= 22; j++) {
          const a = -Math.PI / 2 + (sweep * j) / 22;
          pts.push(`${px(cx + r * Math.cos(a))} ${px(cy + r * Math.sin(a))}`);
        }
        frames.push(`polygon(${pts.join(', ')})`);
      }
      return frames;
    }
    default:
      return undefined;
  }
}

/** Entrance frames for an effect (exits play them backwards). */
function entranceFrames(
  effect: string,
  direction: string | undefined,
  piece: Piece,
  slide: { w: number; h: number },
  k: number
): Frame[] | undefined {
  const box = piece.box;
  const clips = revealClips(effect, direction, box, slide, k);
  if (clips) return clips.map((clipPath) => ({ clipPath }));
  switch (effect) {
    case 'fade':
    case 'fadeOut':
    case 'randomBars':
      return [{ opacity: 0 }, { opacity: 1 }];
    case 'flyIn':
    case 'flyOut': {
      const { dx, dy } = flyOffset(direction, box, slide);
      return [
        { transform: `translate(${dx * k}px, ${dy * k}px)` },
        { transform: 'translate(0px, 0px)' },
      ];
    }
    case 'floatIn':
    case 'floatOut': {
      const up = (direction ?? (effect === 'floatIn' ? 'up' : 'down')) === 'up';
      const shift = slide.h * 0.1 * ((effect === 'floatIn') === up ? 1 : -1);
      return [
        { transform: `translateY(${shift * k}px)`, opacity: 0 },
        { transform: 'translateY(0px)', opacity: 1 },
      ];
    }
    case 'growTurn':
    case 'shrinkTurn':
      return [
        { transform: 'scale(0.01) rotate(-90deg)', opacity: 0 },
        { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      ];
    case 'zoom': {
      if (direction === 'slideCenter') {
        const dx = slide.w / 2 - (box.x + box.w / 2);
        const dy = slide.h / 2 - (box.y + box.h / 2);
        return [
          {
            transform: `translate(${dx * k}px, ${dy * k}px) scale(0.01)`,
            opacity: 0,
          },
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        ];
      }
      return [
        { transform: 'scale(0.01)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ];
    }
    case 'swivel':
      return [
        { transform: 'perspective(800px) rotateY(-1080deg)', opacity: 0 },
        { transform: 'perspective(800px) rotateY(0deg)', opacity: 1 },
      ];
    case 'bounce': {
      const drop = -(box.y + box.h) * k;
      return [
        { transform: `translateY(${drop}px)`, opacity: 0, offset: 0 },
        { transform: 'translateY(0px)', opacity: 1, offset: 0.45 },
        { transform: `translateY(${-box.h * 0.3 * k}px)`, offset: 0.6 },
        { transform: 'translateY(0px)', offset: 0.75 },
        { transform: `translateY(${-box.h * 0.1 * k}px)`, offset: 0.87 },
        { transform: 'translateY(0px)', opacity: 1, offset: 1 },
      ];
    }
    default:
      return [{ opacity: 0 }, { opacity: 1 }];
  }
}

function emphasisFrames(
  effect: string,
  direction: string | undefined,
  piece: Piece,
  k: number
): Frame[] {
  const h = piece.box.h * k;
  switch (effect) {
    case 'pulse':
      return [
        { transform: 'scale(1)' },
        { transform: 'scale(1.06)', offset: 0.5 },
        { transform: 'scale(1)' },
      ];
    case 'colorPulse':
    case 'boldFlash':
      return [
        { filter: 'brightness(1)' },
        { filter: 'brightness(1.6) saturate(1.6)', offset: 0.5 },
        { filter: 'brightness(1)' },
      ];
    case 'teeter':
      return [0, 4, -4, 4, -4, 0].map((deg) => ({
        transform: `rotate(${deg}deg)`,
      }));
    case 'spin':
      return [
        { transform: 'rotate(0deg)' },
        {
          transform: `rotate(${direction === 'counterclockwise' ? -360 : 360}deg)`,
        },
      ];
    case 'growShrink':
      return [{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }];
    case 'transparency':
      return [{ opacity: 1 }, { opacity: 0.5 }];
    case 'desaturate':
      return [{ filter: 'grayscale(0)' }, { filter: 'grayscale(1)' }];
    case 'darken':
      return [{ filter: 'brightness(1)' }, { filter: 'brightness(0.6)' }];
    case 'lighten':
      return [{ filter: 'brightness(1)' }, { filter: 'brightness(1.4)' }];
    case 'wave':
      return [0, -0.12, 0.12, -0.06, 0].map((f) => ({
        transform: `translateY(${f * h}px)`,
      }));
    default:
      return [
        { transform: 'scale(1)' },
        { transform: 'scale(1.04)', offset: 0.5 },
        { transform: 'scale(1)' },
      ];
  }
}

/**
 * Keyframes for animation `a` on `piece`, starting from `state` (lasting
 * offsets, scale, filter, and opacity carry through); undefined for
 * instant effects.
 */
export function effectFrames(
  a: AnimationOutline,
  piece: Piece,
  state: PieceState,
  slide: { w: number; h: number },
  k: number
): EffectFrames | undefined {
  if (a.durationMs <= 0 || a.effect === 'appear' || a.effect === 'disappear')
    return undefined;
  let frames: Frame[];
  let easing = 'ease-out';
  if (a.class === 'entrance') {
    frames = entranceFrames(a.effect, a.direction, piece, slide, k) ?? [];
  } else if (a.class === 'exit') {
    // An exit is its entrance played backwards.
    frames = [...(entranceFrames(a.effect, a.direction, piece, slide, k) ?? [])]
      .reverse()
      .map((f) =>
        f.offset === undefined ? f : { ...f, offset: 1 - f.offset }
      );
    easing = 'ease-in';
  } else if (a.class === 'path') {
    const points = pathPoints(a.path ?? directionPath(a.direction));
    const first = points[0];
    frames = points.map((p) => ({
      transform: `translate(${(p.x - first.x) * slide.w * k}px, ${(p.y - first.y) * slide.h * k}px)`,
    }));
    easing = 'ease-in-out';
  } else {
    frames = emphasisFrames(a.effect, a.direction, piece, k);
    easing = 'ease-in-out';
  }
  if (frames.length === 0) return undefined;
  const base = `translate(${state.dx * k}px, ${state.dy * k}px)`;
  const keyframes = frames.map((f) => {
    const kf: Keyframe = {
      visibility: 'visible',
      transform: `${base} ${f.transform ?? ''} scale(${state.scale})`.replace(
        /\s+/g,
        ' '
      ),
      opacity: (f.opacity ?? 1) * state.opacity,
      filter: `${state.filter} ${f.filter ?? ''}`.trim() || 'none',
    };
    if (f.clipPath) kf.clipPath = f.clipPath;
    if (f.offset !== undefined) kf.offset = f.offset;
    return kf;
  });
  return { keyframes, easing };
}

/** The resting CSS of a piece in `state`. */
export function restingStyle(
  state: PieceState,
  k: number
): { transform: string; opacity: string; filter: string; visibility: string } {
  return {
    transform: `translate(${state.dx * k}px, ${state.dy * k}px) scale(${state.scale})`,
    opacity: String(state.opacity),
    filter: state.filter || 'none',
    visibility: state.visible ? 'visible' : 'hidden',
  };
}
