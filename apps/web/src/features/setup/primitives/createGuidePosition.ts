import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { type GuideRect, placeGuide } from '../core/guidePlacement';
import type { ViewGuideStep } from '../core/viewGuides';

/** Event-driven geometry: no idle frame loop and no document-wide mutation observer. */
export function createGuidePosition(
  anchor: Accessor<HTMLElement | undefined>,
  card: Accessor<HTMLElement | undefined>,
  step: Accessor<ViewGuideStep>
) {
  const [position, setPosition] = createSignal({
    left: 0,
    top: 0,
    ready: false,
    maxWidth: 320,
    maxHeight: 800,
  });
  const [highlight, setHighlight] = createSignal<GuideRect>();
  createEffect(() => {
    const origin = anchor();
    const flyover = card();
    const current = step();
    if (!origin || !flyover) return;
    const scope =
      origin.closest<HTMLElement>('[data-split-id]') ?? origin.parentElement!;
    let frame = 0;
    let observedTarget: HTMLElement | undefined;
    const measure = () => {
      frame = 0;
      if (!origin.isConnected || !flyover.isConnected) return;
      const scopeRect = scope.getBoundingClientRect();
      if (
        !scopeRect.width ||
        !scopeRect.height ||
        scope.closest('[hidden], [inert], [aria-hidden="true"]')
      ) {
        setPosition((p) => ({ ...p, ready: false }));
        setHighlight(undefined);
        return;
      }
      const appTarget = current.appTarget
        ? document.querySelector<HTMLElement>(current.appTarget)
        : undefined;
      const panel = appTarget
        ? {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
          }
        : scope.getBoundingClientRect();
      const bounds = {
        left: Math.max(0, panel.left),
        top: Math.max(0, panel.top),
        width:
          Math.min(window.innerWidth, panel.right) - Math.max(0, panel.left),
        height:
          Math.min(window.innerHeight, panel.bottom) - Math.max(0, panel.top),
      };
      // Detached/hidden split panels must not leave a floating tour behind.
      if (bounds.width < 1 || bounds.height < 1) {
        setPosition((p) => ({ ...p, ready: false }));
        setHighlight(undefined);
        return;
      }
      const candidates = current.targets.flatMap((selector) =>
        Array.from(scope.querySelectorAll<HTMLElement>(selector))
      );
      const target = [...(appTarget ? [appTarget] : []), ...candidates].find(
        (el) => {
          const rect = el.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > bounds.top &&
            rect.top < bounds.top + bounds.height &&
            rect.right > bounds.left &&
            rect.left < bounds.left + bounds.width
          );
        }
      );
      if (target !== observedTarget) {
        if (observedTarget) resize.unobserve(observedTarget);
        observedTarget = target;
        if (target) resize.observe(target);
      }
      const rect = target?.getBoundingClientRect();
      const focus = rect
        ? {
            left: Math.max(bounds.left, rect.left),
            top: Math.max(bounds.top, rect.top),
            width:
              Math.min(bounds.left + bounds.width, rect.right) -
              Math.max(bounds.left, rect.left),
            height:
              Math.min(bounds.top + bounds.height, rect.bottom) -
              Math.max(bounds.top, rect.top),
          }
        : undefined;
      const size = flyover.getBoundingClientRect();
      setPosition({
        ...placeGuide(
          bounds,
          focus,
          Math.min(size.width, bounds.width - 32),
          Math.min(size.height, bounds.height - 32)
        ),
        ready: true,
        maxWidth: Math.max(0, Math.min(320, bounds.width - 32)),
        maxHeight: Math.max(0, bounds.height - 32),
      });
      // Leave room for the rounded outline and its 3px halo even when the
      // target fills a pane or extends past the visible viewport.
      if (focus) {
        const left = Math.max(bounds.left + 8, focus.left - 4);
        const top = Math.max(bounds.top + 8, focus.top - 4);
        const right = Math.min(
          bounds.left + bounds.width - 8,
          focus.left + focus.width + 4
        );
        const bottom = Math.min(
          bounds.top + bounds.height - 8,
          focus.top + focus.height + 4
        );
        setHighlight(
          right > left && bottom > top
            ? { left, top, width: right - left, height: bottom - top }
            : undefined
        );
      } else {
        setHighlight(undefined);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(scope);
    resize.observe(flyover);
    const mutations = new MutationObserver(schedule);
    mutations.observe(scope, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'hidden',
        'inert',
        'aria-hidden',
        'aria-expanded',
        'data-state',
      ],
    });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('scroll', schedule, {
      passive: true,
      capture: true,
    });
    schedule();
    onCleanup(() => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
    });
  });
  return { position, highlight };
}
