import type {
  LayerKeyframe,
  LayerKeyframes,
} from '../../core/transitions/classic-keyframes';

export type TransitionOutcome = 'completed' | 'skipped' | 'cancelled';

export type FrameStats = Readonly<{
  frames: number;
  droppedFrames: number;
  maxFrameGapMs: number;
}>;

/** A 60 Hz frame; longer gaps count the frames they missed. */
const FRAME_MS = 1000 / 60;

/** Counts painted frames until the returned function stops it. Hidden tabs
 * paint none. */
export function watchFrames(): () => FrameStats {
  let frames = 0;
  let droppedFrames = 0;
  let maxFrameGapMs = 0;
  let last: number | undefined;
  let request = requestAnimationFrame(function tick(now) {
    if (last !== undefined) {
      const gap = now - last;
      maxFrameGapMs = Math.max(maxFrameGapMs, gap);
      droppedFrames += Math.max(0, Math.round(gap / FRAME_MS) - 1);
    }
    frames++;
    last = now;
    request = requestAnimationFrame(tick);
  });
  return () => {
    cancelAnimationFrame(request);
    return { frames, droppedFrames, maxFrameGapMs: Math.round(maxFrameGapMs) };
  };
}

const toKeyframes = (frames: readonly LayerKeyframe[]): Keyframe[] =>
  frames.map((frame) => ({ ...frame }));

/**
 * Animates the outgoing and incoming slide layers of a classic transition.
 * Stacking and perspective are set inline for the run; the returned restore
 * puts them back.
 */
export function animateLayers(input: {
  stage: HTMLElement;
  outgoing: HTMLElement | undefined;
  incoming: HTMLElement;
  keyframes: LayerKeyframes;
  durationMs: number;
  easing: string;
}): { animations: Animation[]; restore: () => void } {
  const { stage, outgoing, incoming, keyframes } = input;
  const timing: KeyframeAnimationOptions = {
    duration: input.durationMs,
    easing: input.easing,
    fill: 'both',
  };

  stage.style.perspective = keyframes.perspective
    ? `${keyframes.perspective}px`
    : '';
  incoming.style.zIndex = keyframes.incomingOnTop ? '2' : '1';
  if (outgoing) outgoing.style.zIndex = keyframes.incomingOnTop ? '1' : '2';
  const threeD = !!keyframes.perspective;
  for (const layer of [incoming, outgoing]) {
    if (layer && threeD) layer.style.backfaceVisibility = 'hidden';
  }

  const animations = [
    keyframes.incoming.length
      ? incoming.animate(toKeyframes(keyframes.incoming), timing)
      : undefined,
    outgoing && keyframes.outgoing.length
      ? outgoing.animate(toKeyframes(keyframes.outgoing), timing)
      : undefined,
  ].filter((animation) => animation !== undefined);

  return {
    animations,
    restore: () => {
      stage.style.perspective = '';
      for (const layer of [incoming, outgoing]) {
        if (!layer) continue;
        layer.style.zIndex = '';
        layer.style.backfaceVisibility = '';
      }
    },
  };
}

/**
 * Moves the camera of a canvas transition: one transform on the world layer,
 * interpolated between pre-eased samples. The slide masks letterbox the first
 * and last frames exactly as present mode shows a slide, and fade while the
 * camera is away so the canvas around the slides shows.
 */
export function animateCamera(input: {
  world: HTMLElement;
  fromMask: HTMLElement;
  toMask: HTMLElement;
  transforms: readonly string[];
  durationMs: number;
}): Animation[] {
  const timing: KeyframeAnimationOptions = {
    duration: input.durationMs,
    easing: 'linear',
    fill: 'both',
  };
  const fade = Math.min(0.2, 250 / Math.max(input.durationMs, 1));
  return [
    input.world.animate(
      input.transforms.map((transform) => ({ transform })),
      timing
    ),
    input.fromMask.animate(
      [{ opacity: 1 }, { opacity: 0, offset: fade }, { opacity: 0 }],
      timing
    ),
    input.toMask.animate(
      [{ opacity: 0 }, { opacity: 0, offset: 1 - fade }, { opacity: 1 }],
      timing
    ),
  ];
}

/** Resolves when every animation has finished; rejects if one is cancelled. */
export async function animationsFinished(animations: readonly Animation[]) {
  await Promise.all(animations.map((animation) => animation.finished));
}
