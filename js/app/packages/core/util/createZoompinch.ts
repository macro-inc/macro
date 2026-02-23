import { Zoompinch } from '@zoompinch/core';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

export type ZoompinchOptions = {
  minScale?: number;
  maxScale?: number;
  clampBounds?: boolean;
  rotation?: boolean;
  /** Called on every transform update. */
  onUpdate?: (engine: Zoompinch) => void;
  /**
   * Override the wheel handler. Defaults to forwarding the event to the engine,
   * which zooms when ctrlKey is held and pans otherwise (trackpad-friendly).
   * Override to e.g. always zoom regardless of ctrlKey.
   */
  onWheel?: (e: WheelEvent, engine: Zoompinch) => void;
  /**
   * Override individual touch handlers. Each defaults to forwarding the event
   * directly to the engine. Useful for e.g. swipe-to-navigate at scale 1.
   * The engine is passed as the second argument so callers can fall back to it.
   */
  touch?: {
    onStart?: (e: TouchEvent, engine: Zoompinch) => void;
    onWindowMove?: (e: TouchEvent, engine: Zoompinch) => void;
    onWindowEnd?: (e: TouchEvent, engine: Zoompinch) => void;
  };
};

/**
 * SolidJS primitive that creates and manages a Zoompinch instance on a wrapper
 * element. Wires mouse, wheel, touch, and Safari gesture event handlers and
 * cleans up on unmount.
 *
 * The wrapper element must contain a child with class "canvas" (Zoompinch
 * targets it via querySelector).
 *
 * Returns a signal accessor for the current engine instance.
 */
export function createZoompinch(
  getWrapper: Accessor<HTMLElement | undefined>,
  options: ZoompinchOptions = {}
): Accessor<Zoompinch | null> {
  const [engine, setEngine] = createSignal<Zoompinch | null>(null);

  createEffect(() => {
    const wrapper = getWrapper();
    if (!wrapper) return;

    const {
      minScale = 1,
      maxScale = 5,
      clampBounds = false,
      rotation = false,
      onUpdate,
      onWheel: onWheelOverride,
      touch = {},
    } = options;

    const e = new Zoompinch(
      wrapper,
      { top: 0, right: 0, bottom: 0, left: 0 },
      0, // translateX
      0, // translateY
      1, // scale
      0, // rotate
      minScale,
      maxScale,
      clampBounds,
      rotation
    );

    // Zoompinch initializes canvasBounds/wrapperBounds in a rAF callback, but
    // its ResizeObserver callbacks fire before rAF and access canvasBounds —
    // crashing if uninitialized. Pre-populate synchronously as a workaround.
    const canvasEl = wrapper.querySelector('.canvas') as HTMLElement | null;
    if (canvasEl) {
      e.canvasBounds = canvasEl.getBoundingClientRect();
      e.wrapperBounds = wrapper.getBoundingClientRect();
    }

    e.addEventListener('init', () => {
      e.applyTransform(1, [0.5, 0.5], [0.5, 0.5]);
    });

    if (onUpdate) {
      e.addEventListener('update', () => onUpdate(e));
    }

    setEngine(e);

    // Mouse pan (mousedown on wrapper, move/up on window)
    const handleMouseDown = (ev: MouseEvent) => e.handleMousedown(ev);
    const handleWindowMouseMove = (ev: MouseEvent) => e.handleMousemove(ev);
    const handleWindowMouseUp = (ev: MouseEvent) => e.handleMouseup(ev);
    wrapper.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    // Scroll wheel zoom
    const handleWheel = (ev: WheelEvent) =>
      onWheelOverride ? onWheelOverride(ev, e) : e.handleWheel(ev);
    wrapper.addEventListener('wheel', handleWheel);

    // Safari desktop pinch-to-zoom via gesture events
    const handleGestureStart = (ev: Event) =>
      e.handleGesturestart(ev as UIEvent);
    const handleGestureChange = (ev: Event) =>
      e.handleGesturechange(ev as UIEvent);
    const handleGestureEnd = (ev: Event) => e.handleGestureend(ev as UIEvent);
    wrapper.addEventListener('gesturestart', handleGestureStart);
    window.addEventListener('gesturechange', handleGestureChange);
    window.addEventListener('gestureend', handleGestureEnd);

    // Touch — override-able so callers can intercept for e.g. swipe navigation
    const onTouchStart = touch.onStart ?? ((ev) => e.handleTouchstart(ev));
    const onWindowTouchMove =
      touch.onWindowMove ?? ((ev) => e.handleTouchmove(ev));
    const onWindowTouchEnd =
      touch.onWindowEnd ?? ((ev) => e.handleTouchend(ev));
    const handleTouchStart = (ev: TouchEvent) => onTouchStart(ev, e);
    const handleWindowTouchMove = (ev: TouchEvent) => onWindowTouchMove(ev, e);
    const handleWindowTouchEnd = (ev: TouchEvent) => onWindowTouchEnd(ev, e);
    wrapper.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleWindowTouchMove, {
      passive: false,
    });
    window.addEventListener('touchend', handleWindowTouchEnd, {
      passive: true,
    });

    onCleanup(() => {
      e.destroy();
      setEngine(null);
      wrapper.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      wrapper.removeEventListener('wheel', handleWheel);
      wrapper.removeEventListener('gesturestart', handleGestureStart);
      window.removeEventListener('gesturechange', handleGestureChange);
      window.removeEventListener('gestureend', handleGestureEnd);
      wrapper.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleWindowTouchEnd);
    });
  });

  return engine;
}
