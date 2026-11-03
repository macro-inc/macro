import { createSharedRoot } from '@solid-primitives/rootless';
import { onCleanup } from 'solid-js';

type AnimatedElement = HTMLElement | SVGElement;

/** One shared viewport observer for mounted animation owners. */
const useAnimationVisibility = createSharedRoot(() => {
  const elements = new Map<
    AnimatedElement,
    { intersecting: boolean; pausedSvg: boolean }
  >();
  const update = (element: AnimatedElement) => {
    const state = elements.get(element);
    if (!state) return;
    const paused = !state.intersecting;
    const playState = paused ? 'paused' : 'running';
    if (
      element.style.getPropertyValue('--animation-play-state') !== playState
    ) {
      element.style.setProperty('--animation-play-state', playState);
    }
    if (
      element instanceof SVGSVGElement &&
      typeof element.animationsPaused === 'function'
    ) {
      if (paused && !element.animationsPaused()) {
        element.pauseAnimations();
        state.pausedSvg = true;
      } else if (!paused && state.pausedSvg) {
        element.unpauseAnimations();
        state.pausedSvg = false;
      }
    }
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const element = entry.target;
      if (!(element instanceof HTMLElement || element instanceof SVGElement))
        continue;
      const state = elements.get(element);
      if (!state) continue;
      state.intersecting = entry.isIntersecting;
      update(element);
    }
  });
  onCleanup(() => {
    observer.disconnect();
  });
  return (element: AnimatedElement) => {
    const previous = element.style.getPropertyValue('--animation-play-state');
    const priority = element.style.getPropertyPriority(
      '--animation-play-state'
    );
    elements.set(element, { intersecting: true, pausedSvg: false });
    observer.observe(element);
    update(element);
    onCleanup(() => {
      observer.unobserve(element);
      if (elements.get(element)?.pausedSvg && element instanceof SVGSVGElement)
        element.unpauseAnimations();
      elements.delete(element);
      if (previous)
        element.style.setProperty('--animation-play-state', previous, priority);
      else element.style.removeProperty('--animation-play-state');
    });
  };
});

/**
 * Ref for a component that owns an infinite decoration. CSS animations inherit
 * --animation-play-state; SVG roots also pause SMIL. Neither resets its phase.
 * The observer is shared and disappears when the last owner unmounts.
 */
export function pauseOffscreenAnimations(element: AnimatedElement) {
  // Non-layout renderers cannot determine visibility; leave their timing alone.
  if (typeof IntersectionObserver === 'undefined') return;
  useAnimationVisibility()(element);
}
