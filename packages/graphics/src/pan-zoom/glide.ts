import type { Point } from '../core/model';

/** One 60fps frame: the unit the friction is expressed in. */
const FRAME_MS = 1000 / 60;
/** About two frames. A longer gap (a stalled tab) must not turn into a jump. */
const MAX_FRAME_MS = 32;
/** Velocity kept per 60fps frame. */
const FRICTION = 0.86;
/** px/ms. Below this the glide stops, and a release this slow never starts one. */
const MIN_SPEED = 0.015;
/** px/ms. Bounds a pathologically fast flick. */
const MAX_SPEED = 2.75;
/** Only positions this recent count toward the release velocity. */
const SAMPLE_WINDOW_MS = 160;
/** A move smaller than this counts as "did not move". */
const STALLED_PX = 0.01;

type Sample = Point & { time: number };

/**
 * Inertial panning. While a pan is in progress the caller reports where the
 * finger (or the midpoint of two) is; on release the content keeps moving at
 * the release velocity and eases to a stop.
 *
 * The glide owns no transform. `move` applies a screen-space delta to whatever
 * is being panned and returns the part that took effect, so an axis stopped at
 * a bound drops its velocity instead of coasting in place.
 */
export function createGlide(move: (delta: Point) => Point) {
  let samples: Sample[] = [];
  let frame: number | undefined;
  // Counts glides started or stopped, so a frame can tell it was cancelled
  // while it ran: `move` may tear down whatever is gliding.
  let run = 0;

  const cancel = () => {
    run++;
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    frame = undefined;
  };

  /** Forget the tracked positions: the next `track` starts a new measurement. */
  const reset = () => {
    samples = [];
  };

  const track = (point: Point, time: number) => {
    samples.push({ x: point.x, y: point.y, time });
    while (samples.length > 1 && time - samples[0]!.time > SAMPLE_WINDOW_MS)
      samples.shift();
  };

  const releaseVelocity = (): Point => {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = first && last ? last.time - first.time : 0;
    if (!first || !last || elapsed <= 0) return { x: 0, y: 0 };
    return {
      x: (last.x - first.x) / elapsed,
      y: (last.y - first.y) / elapsed,
    };
  };

  /** Start gliding at the tracked velocity. False when it is too slow to glide. */
  const release = () => {
    cancel();
    let { x: vx, y: vy } = releaseVelocity();
    reset();
    const speed = Math.hypot(vx, vy);
    if (speed < MIN_SPEED) return false;
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed;
      vy *= MAX_SPEED / speed;
    }

    const thisRun = run;
    let previous = performance.now();
    const step = () => {
      const now = performance.now();
      const elapsed = Math.min(now - previous, MAX_FRAME_MS);
      previous = now;

      const attempted = { x: vx * elapsed, y: vy * elapsed };
      const moved = move(attempted);
      if (run !== thisRun) return;
      if (Math.abs(attempted.x) > STALLED_PX && Math.abs(moved.x) < STALLED_PX)
        vx = 0;
      if (Math.abs(attempted.y) > STALLED_PX && Math.abs(moved.y) < STALLED_PX)
        vy = 0;

      const decay = FRICTION ** (elapsed / FRAME_MS);
      vx *= decay;
      vy *= decay;
      frame =
        Math.hypot(vx, vy) < MIN_SPEED
          ? undefined
          : requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return true;
  };

  return { track, reset, release, cancel };
}
