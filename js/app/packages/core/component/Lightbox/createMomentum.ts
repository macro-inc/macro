import { type Accessor, onCleanup } from 'solid-js';
import type { ZoompinchHandle } from '../Zoompinch';

/**
 * Inertial panning ("momentum"). After a single-finger pan while zoomed in,
 * releasing lets the image keep gliding in the release direction and ease to a
 * stop. Release velocity is sampled from a short window of touch positions,
 * including the final changedTouches point from touchend; the rAF loop then
 * replays that velocity through setTranslateFromUserGesture, so the engine still
 * clamps every frame and naturally kills motion at the bounds.
 */
export function createMomentum(
  zoompinchHandle: Accessor<ZoompinchHandle | undefined>
) {
  const MOMENTUM_FRAME_MS = 1000 / 60; // one 60fps frame, the friction base unit
  const MOMENTUM_MAX_FRAME_MS = 32; // ~2 frames; cap dt to avoid post-stall jumps
  const MOMENTUM_FRICTION = 0.86; // velocity retained per 60fps frame
  const MOMENTUM_MIN_SPEED = 0.015; // px/ms — below this the glide stops
  const MOMENTUM_MAX_SPEED = 2.75; // px/ms — clamp pathologically fast flicks
  const MOMENTUM_SAMPLE_WINDOW_MS = 160;
  const MOMENTUM_CLAMP_EPSILON_PX = 0.01; // sub-px move counts as "didn't move"
  let momentumVx = 0; // px/ms
  let momentumVy = 0;
  let momentumRaf: number | undefined;
  let momentumActiveTouchId: number | undefined;
  let momentumStartX = 0;
  let momentumStartY = 0;
  let momentumStartTranslateX = 0;
  let momentumStartTranslateY = 0;
  let momentumSamples: { x: number; y: number; t: number }[] = [];

  const cancelMomentum = () => {
    if (momentumRaf !== undefined) {
      cancelAnimationFrame(momentumRaf);
      momentumRaf = undefined;
    }
  };
  onCleanup(cancelMomentum);

  const eventTime = (e: TouchEvent) => e.timeStamp || performance.now();

  const getMomentumTouch = (touches: TouchList) => {
    if (momentumActiveTouchId === undefined) return touches[0];
    return (
      Array.from(touches).find(
        (touch) => touch.identifier === momentumActiveTouchId
      ) ?? touches[0]
    );
  };

  // Re-baseline velocity tracking when an engine-handled gesture starts or
  // changes touch count so the next single-finger move measures cleanly.
  const resetMomentumTracking = (
    e: TouchEvent,
    engine: ZoompinchHandle['engine']
  ) => {
    momentumVx = 0;
    momentumVy = 0;
    momentumActiveTouchId = undefined;
    const touch = e.touches.length === 1 ? e.touches[0] : undefined;
    const t = eventTime(e);
    if (!touch) {
      momentumSamples = [];
      return;
    }
    momentumActiveTouchId = touch.identifier;
    momentumStartX = touch.clientX;
    momentumStartY = touch.clientY;
    momentumStartTranslateX = engine.translateX;
    momentumStartTranslateY = engine.translateY;
    momentumSamples = [{ x: touch.clientX, y: touch.clientY, t }];
  };

  const sampleMomentumTouch = (touch: Touch | undefined, t: number) => {
    if (!touch) return;
    momentumSamples.push({ x: touch.clientX, y: touch.clientY, t });
    while (
      momentumSamples.length > 1 &&
      t - momentumSamples[0].t > MOMENTUM_SAMPLE_WINDOW_MS
    ) {
      momentumSamples.shift();
    }
    const first = momentumSamples[0];
    const last = momentumSamples[momentumSamples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) {
      momentumVx = 0;
      momentumVy = 0;
    } else {
      momentumVx = (last.x - first.x) / dt;
      momentumVy = (last.y - first.y) / dt;
    }
  };

  // Fold the latest single-finger touch position into the release velocity.
  const sampleMomentum = (e: TouchEvent) => {
    sampleMomentumTouch(getMomentumTouch(e.touches), eventTime(e));
  };

  const startMomentum = (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
    cancelMomentum();
    const activeTouchId = momentumActiveTouchId;
    if (activeTouchId === undefined || momentumSamples.length === 0) return;
    const releaseTime = eventTime(e);
    const releaseTouch = Array.from(e.changedTouches).find(
      (touch) => touch.identifier === activeTouchId
    );
    if (!releaseTouch) return;
    engine.setTranslateFromUserGesture(
      momentumStartTranslateX + releaseTouch.clientX - momentumStartX,
      momentumStartTranslateY + releaseTouch.clientY - momentumStartY
    );
    engine.update();
    sampleMomentumTouch(releaseTouch, releaseTime);
    const speed = Math.hypot(momentumVx, momentumVy);
    if (speed < MOMENTUM_MIN_SPEED) return;
    if (speed > MOMENTUM_MAX_SPEED) {
      const k = MOMENTUM_MAX_SPEED / speed;
      momentumVx *= k;
      momentumVy *= k;
    }

    let lastFrame = performance.now();
    const step = () => {
      // Bail if the engine went away (unmount / image swap) mid-glide.
      if (!zoompinchHandle()) {
        momentumRaf = undefined;
        return;
      }
      const now = performance.now();
      const dt = Math.min(now - lastFrame, MOMENTUM_MAX_FRAME_MS);
      lastFrame = now;

      const beforeX = engine.translateX;
      const beforeY = engine.translateY;
      const attemptedDx = Math.abs(momentumVx * dt);
      const attemptedDy = Math.abs(momentumVy * dt);
      engine.setTranslateFromUserGesture(
        engine.translateX + momentumVx * dt,
        engine.translateY + momentumVy * dt
      );
      engine.update();

      // An axis pinned at a clamp edge stops moving — drop its velocity so the
      // glide doesn't coast in place.
      if (
        attemptedDx > MOMENTUM_CLAMP_EPSILON_PX &&
        Math.abs(engine.translateX - beforeX) < MOMENTUM_CLAMP_EPSILON_PX
      ) {
        momentumVx = 0;
      }
      if (
        attemptedDy > MOMENTUM_CLAMP_EPSILON_PX &&
        Math.abs(engine.translateY - beforeY) < MOMENTUM_CLAMP_EPSILON_PX
      ) {
        momentumVy = 0;
      }

      const decay = MOMENTUM_FRICTION ** (dt / MOMENTUM_FRAME_MS);
      momentumVx *= decay;
      momentumVy *= decay;

      if (Math.hypot(momentumVx, momentumVy) < MOMENTUM_MIN_SPEED) {
        momentumRaf = undefined;
        return;
      }
      momentumRaf = requestAnimationFrame(step);
    };
    momentumRaf = requestAnimationFrame(step);
  };

  return {
    cancelMomentum,
    resetMomentumTracking,
    sampleMomentum,
    startMomentum,
  };
}
