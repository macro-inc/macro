import { createGlide } from '@macro-inc/graphics/pan-zoom';
import { type Accessor, onCleanup } from 'solid-js';
import type { ZoompinchHandle } from '../Zoompinch';

/**
 * Inertial panning ("momentum"). After a single-finger pan while zoomed in,
 * releasing lets the image keep gliding in the release direction and ease to a
 * stop. The velocity tracking and the glide itself are the shared pan/zoom
 * primitive, which Canvas also uses; this adapter follows one finger through a
 * touch sequence and moves the zoompinch engine, which still clamps every
 * frame and so stops the glide at the bounds.
 */
export function createMomentum(
  zoompinchHandle: Accessor<ZoompinchHandle | undefined>
) {
  let activeTouchId: number | undefined;
  let startX = 0;
  let startY = 0;
  let startTranslateX = 0;
  let startTranslateY = 0;

  const glide = createGlide((delta) => {
    // The engine went away (unmount / image swap) mid-glide: nothing moves.
    const engine = zoompinchHandle()?.engine;
    if (!engine) return { x: 0, y: 0 };

    const beforeX = engine.translateX;
    const beforeY = engine.translateY;
    engine.setTranslateFromUserGesture(beforeX + delta.x, beforeY + delta.y);
    engine.update();
    return { x: engine.translateX - beforeX, y: engine.translateY - beforeY };
  });
  onCleanup(glide.cancel);

  const eventTime = (e: TouchEvent) => e.timeStamp || performance.now();

  const getMomentumTouch = (touches: TouchList) => {
    if (activeTouchId === undefined) return touches[0];
    return (
      Array.from(touches).find((touch) => touch.identifier === activeTouchId) ??
      touches[0]
    );
  };

  const trackTouch = (touch: Touch | undefined, time: number) => {
    if (touch) glide.track({ x: touch.clientX, y: touch.clientY }, time);
  };

  // Re-baseline velocity tracking when an engine-handled gesture starts or
  // changes touch count so the next single-finger move measures cleanly.
  const resetMomentumTracking = (
    e: TouchEvent,
    engine: ZoompinchHandle['engine']
  ) => {
    glide.reset();
    activeTouchId = undefined;
    const touch = e.touches.length === 1 ? e.touches[0] : undefined;
    if (!touch) return;

    activeTouchId = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    startTranslateX = engine.translateX;
    startTranslateY = engine.translateY;
    trackTouch(touch, eventTime(e));
  };

  // Fold the latest single-finger touch position into the release velocity.
  const sampleMomentum = (e: TouchEvent) => {
    trackTouch(getMomentumTouch(e.touches), eventTime(e));
  };

  const startMomentum = (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
    glide.cancel();
    const releaseTouch = Array.from(e.changedTouches).find(
      (touch) => touch.identifier === activeTouchId
    );
    if (!releaseTouch) return;

    // touchend carries the finger's last position, which no touchmove reported.
    engine.setTranslateFromUserGesture(
      startTranslateX + releaseTouch.clientX - startX,
      startTranslateY + releaseTouch.clientY - startY
    );
    engine.update();
    trackTouch(releaseTouch, eventTime(e));
    glide.release();
  };

  return {
    cancelMomentum: glide.cancel,
    resetMomentumTracking,
    sampleMomentum,
    startMomentum,
  };
}
