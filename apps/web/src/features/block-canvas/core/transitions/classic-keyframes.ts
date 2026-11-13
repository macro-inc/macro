import type {
  CLASSIC_TRANSITION_KINDS,
  TransitionDirection,
} from '@macro-inc/graphics';
import { match } from 'ts-pattern';

export type ClassicKind = Exclude<
  (typeof CLASSIC_TRANSITION_KINDS)[number],
  'none'
>;

/** A keyframe for one slide layer. Most kinds animate only transform and
 * opacity, which the compositor runs off the main thread. Wipe, split and iris
 * animate `clip-path`, and dissolve (the outgoing slide's blur) and cube (its
 * shading) animate `filter`; browsers may repaint those each frame. */
export type LayerKeyframe = Readonly<{
  offset?: number;
  opacity?: number;
  transform?: string;
  clipPath?: string;
  filter?: string;
}>;

/** How the outgoing and incoming layers move. An empty list leaves that layer
 * still. */
export type LayerKeyframes = Readonly<{
  outgoing: readonly LayerKeyframe[];
  incoming: readonly LayerKeyframe[];
  incomingOnTop: boolean;
  /** Stage perspective in px, for 3D kinds. */
  perspective?: number;
}>;

type Size = Readonly<{ width: number; height: number }>;

/** Unit vector of motion: `left` moves content leftward, so the next slide
 * enters from the right. */
const VECTORS: Record<TransitionDirection, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const translate = (x: number, y: number) => `translate(${x}%, ${y}%)`;

/**
 * Keyframes for a classic kind. Going backward plays the mirror, like Google
 * Slides: the forward animation with the layers' roles swapped and time
 * reversed, so a push left comes back as a push right and an opening iris
 * closes.
 */
export function classicKeyframes(
  kind: ClassicKind,
  direction: TransitionDirection,
  backward: boolean,
  size: Size
): LayerKeyframes {
  const forward = forwardKeyframes(kind, direction, size);
  if (!backward) return forward;

  return {
    outgoing: reversed(forward.incoming),
    incoming: reversed(forward.outgoing),
    incomingOnTop: !forward.incomingOnTop,
    perspective: forward.perspective,
  };
}

function reversed(frames: readonly LayerKeyframe[]): LayerKeyframe[] {
  return frames
    .map((frame, index) => {
      const offset = frame.offset ?? index / Math.max(frames.length - 1, 1);
      return { ...frame, offset: 1 - offset };
    })
    .reverse();
}

function forwardKeyframes(
  kind: ClassicKind,
  direction: TransitionDirection,
  size: Size
): LayerKeyframes {
  const v = VECTORS[direction];
  const horizontal = v.y === 0;

  return match(kind)
    .with('fade', () => ({
      outgoing: [],
      incoming: [{ opacity: 0 }, { opacity: 1 }],
      incomingOnTop: true,
    }))
    .with('fadeThroughBlack', () => ({
      outgoing: [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
      incoming: [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }],
      incomingOnTop: true,
    }))
    .with('dissolve', () => ({
      // Only the outgoing slide blurs, and only a little: blurring both
      // full-screen layers costs a repaint of each every frame.
      outgoing: [
        { opacity: 1, filter: 'blur(0px)' },
        { opacity: 0, filter: 'blur(6px)' },
      ],
      incoming: [
        { opacity: 0, transform: 'scale(1.03)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      incomingOnTop: true,
    }))
    .with('push', () => ({
      outgoing: [
        { transform: translate(0, 0) },
        { transform: translate(v.x * 100, v.y * 100) },
      ],
      incoming: [
        { transform: translate(-v.x * 100, -v.y * 100) },
        { transform: translate(0, 0) },
      ],
      incomingOnTop: true,
    }))
    .with('cover', () => ({
      outgoing: [{ opacity: 1 }, { opacity: 0.55 }],
      incoming: [
        { transform: translate(-v.x * 100, -v.y * 100) },
        { transform: translate(0, 0) },
      ],
      incomingOnTop: true,
    }))
    .with('uncover', () => ({
      outgoing: [
        { transform: translate(0, 0) },
        { transform: translate(v.x * 100, v.y * 100) },
      ],
      incoming: [{ opacity: 0.55 }, { opacity: 1 }],
      incomingOnTop: false,
    }))
    .with('wipe', () => ({
      outgoing: [],
      incoming: [
        { clipPath: wipeStart(direction) },
        { clipPath: 'inset(0% 0% 0% 0%)' },
      ],
      incomingOnTop: true,
    }))
    .with('split', () => {
      // Left and up open from a center seam; right and down close onto it.
      const seam = horizontal ? 'inset(0% 50% 0% 50%)' : 'inset(50% 0% 50% 0%)';
      const opens = direction === 'left' || direction === 'up';
      if (opens)
        return {
          outgoing: [],
          incoming: [{ clipPath: seam }, { clipPath: 'inset(0% 0% 0% 0%)' }],
          incomingOnTop: true,
        };
      return {
        outgoing: [{ clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: seam }],
        incoming: [],
        incomingOnTop: false,
      };
    })
    .with('iris', () => ({
      outgoing: [],
      incoming: [
        { clipPath: 'circle(0% at 50% 50%)' },
        { clipPath: 'circle(72% at 50% 50%)' },
      ],
      incomingOnTop: true,
    }))
    .with('zoom', () => ({
      outgoing: [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(1.12)' },
      ],
      incoming: [
        { opacity: 0, transform: 'scale(0.82)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      incomingOnTop: true,
    }))
    .with('flip', () => {
      // A card turning over: both faces rotate half a turn together and each
      // hides its back, dipping away from the viewer at the midpoint.
      const axis = horizontal ? 'rotateY' : 'rotateX';
      const sign = horizontal ? -v.x : v.y;
      const depth = Math.round(Math.max(size.width, size.height) * 0.25);
      const turn = (z: number, degrees: number) =>
        `translateZ(${z}px) ${axis}(${degrees}deg)`;
      return {
        outgoing: [
          { transform: turn(0, 0) },
          { transform: turn(-depth, sign * -90), offset: 0.5 },
          { transform: turn(0, sign * -180) },
        ],
        incoming: [
          { transform: turn(0, sign * 180) },
          { transform: turn(-depth, sign * 90), offset: 0.5 },
          { transform: turn(0, 0) },
        ],
        incomingOnTop: true,
        perspective: Math.max(size.width, size.height) * 2,
      };
    })
    .with('cube', () => {
      // Each slide is a face of a cube whose center sits half a face behind
      // the screen; the cube turns a quarter.
      const axis = horizontal ? 'rotateY' : 'rotateX';
      const half = (horizontal ? size.width : size.height) / 2;
      const sign = horizontal ? -v.x : v.y;
      const face = (degrees: number) =>
        `translateZ(${-half}px) ${axis}(${degrees}deg) translateZ(${half}px)`;
      return {
        outgoing: [
          { transform: face(0), filter: 'brightness(1)' },
          { transform: face(sign * -90), filter: 'brightness(0.6)' },
        ],
        incoming: [
          { transform: face(sign * 90), filter: 'brightness(0.6)' },
          { transform: face(0), filter: 'brightness(1)' },
        ],
        incomingOnTop: true,
        perspective: Math.max(size.width, size.height) * 1.6,
      };
    })
    .exhaustive();
}

/** Clip that hides the incoming slide on the side the wipe starts from. */
function wipeStart(direction: TransitionDirection): string {
  return match(direction)
    .with('left', () => 'inset(0% 0% 0% 100%)')
    .with('right', () => 'inset(0% 100% 0% 0%)')
    .with('up', () => 'inset(100% 0% 0% 0%)')
    .with('down', () => 'inset(0% 0% 100% 0%)')
    .exhaustive();
}
