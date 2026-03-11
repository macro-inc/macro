import { Zoompinch as ZoompinchEngine } from '@zoompinch/core';
import { createEffect, createSignal, type JSX, onCleanup } from 'solid-js';

export type ZoompinchHandle = {
  engine: ZoompinchEngine;
  wrapperElement: HTMLDivElement;
};

export type ZoompinchProps = {
  handleRef?: (handle: ZoompinchHandle | undefined) => void;
  minScale?: number;
  maxScale?: number;
  clampBounds?: boolean;
  rotation?: boolean;
  /** Called on every transform update. */
  onUpdate?: (engine: ZoompinchEngine) => void;
  /**
   * Override the wheel handler. Defaults to forwarding to the engine, which
   * zooms when ctrlKey is held and pans otherwise (trackpad-friendly).
   */
  onWheel?: (e: WheelEvent, engine: ZoompinchEngine) => void;
  /**
   * Override individual touch handlers. Each defaults to forwarding directly
   * to the engine. Useful for intercepting swipes for gallery navigation.
   */
  touch?: {
    onStart?: (e: TouchEvent, engine: ZoompinchEngine) => void;
    onWindowMove?: (e: TouchEvent, engine: ZoompinchEngine) => void;
    onWindowEnd?: (e: TouchEvent, engine: ZoompinchEngine) => void;
  };
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
};

/**
 * SolidJS component that wraps a Zoompinch engine. Renders a wrapper div with
 * a .canvas child and wires all mouse, wheel, touch, and gesture event handlers.
 *
 * Exposes an imperative handle via `ref` for calling `applyTransform` etc.
 * The handle is set when the engine initialises and cleared on unmount.
 */
export function Zoompinch(props: ZoompinchProps) {
  const [wrapperRef, setWrapperRef] = createSignal<
    HTMLDivElement | undefined
  >();

  // Snapshot stable config at component init — not reactive.
  // The engine doesn't support hot-reloading options, so this is intentional.
  const minScale = props.minScale ?? 1;
  const maxScale = props.maxScale ?? 5;
  const clampBounds = props.clampBounds ?? false;
  const rotation = props.rotation ?? false;
  const onUpdate = props.onUpdate;
  const onWheelOverride = props.onWheel;
  const touch = props.touch ?? {};
  const ref = props.handleRef;

  createEffect(() => {
    const wrapper = wrapperRef();
    if (!wrapper) return;

    const e = new ZoompinchEngine(
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

    e.addEventListener('init', () =>
      e.applyTransform(1, [0.5, 0.5], [0.5, 0.5])
    );
    if (onUpdate) e.addEventListener('update', () => onUpdate(e));

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

    // Touch — overrideable for swipe navigation etc.
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

    ref?.({ engine: e, wrapperElement: wrapper });

    onCleanup(() => {
      ref?.(undefined);
      e.destroy();
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

  return (
    <div
      ref={setWrapperRef}
      class={props.class}
      style={{ ...props.style, 'touch-action': 'none' }}
    >
      <div class="canvas w-full h-full will-change-transform">
        {props.children}
      </div>
    </div>
  );
}
