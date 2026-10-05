import {
  type AnimationTarget,
  createAnimationGroup,
} from '@app/lib/utils/create-animation-group';
import { createMediaQuery } from '@solid-primitives/media';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/** Geometry belongs to Resize; these frames temporarily accompany the slide. */
function splitFrames(
  element: HTMLElement,
  hostContent: HTMLElement | undefined,
  opening: boolean,
  interrupted: boolean
): AnimationTarget[] {
  const panel = element.parentElement;
  if (!panel?.matches('[data-resize-panel]')) return [];
  const host =
    hostContent?.hidden || hostContent?.hasAttribute('data-slide-underlay')
      ? undefined
      : hostContent?.parentElement;
  const gutter = panel.parentElement?.querySelector<HTMLElement>(
    ':scope > [role="separator"]'
  );
  const frames: AnimationTarget[] = [];
  if (host) {
    frames.push({
      target: host,
      keyframes: [
        {
          width:
            interrupted || !opening ? getComputedStyle(host).width : '100%',
        },
        { width: opening ? host.style.width : '100%' },
      ],
    });
  }
  if (gutter) {
    gutter.inert = !opening;
    frames.push({
      target: gutter,
      keyframes: [
        {
          transform:
            interrupted || !opening
              ? getComputedStyle(gutter).transform
              : `translateX(${panel.style.width})`,
        },
        {
          transform: opening
            ? 'translateX(0)'
            : `translateX(${panel.style.width})`,
        },
      ],
    });
  }
  return frames;
}

/** Retain the pane's owner and Resize registration until its slide finishes. */
export function createSplitPresence(
  visible: Accessor<boolean>,
  hostContent: Accessor<HTMLElement | undefined>
) {
  const reducedMotion = createMediaQuery('(prefers-reduced-motion: reduce)');
  const [present, setPresent] = createSignal(visible());
  const [transitioning, setTransitioning] = createSignal(false);
  const motion = createAnimationGroup();
  let element: HTMLDivElement | undefined;
  let revision = 0;

  const finish = () => {
    revision += 1;
    // Settle to current intent, not an interrupted animation's old endpoint.
    setPresent(visible());
    motion.cancel();
    setTransitioning(false);
  };
  createEffect(
    on(visible, (opening) => {
      const current = ++revision;
      setTransitioning(
        !reducedMotion() && typeof HTMLElement.prototype.animate === 'function'
      );
      if (opening) setPresent(true);
      if (!opening && (reducedMotion() || !element?.animate)) {
        finish();
        return;
      }
      queueMicrotask(() => {
        if (current !== revision || !element) return;
        // Read live styles before releasing the interrupted group's frames.
        const interrupted = motion.running();
        const transform = interrupted
          ? getComputedStyle(element).transform
          : opening
            ? 'translateX(100%)'
            : 'translateX(0)';
        element.inert = !opening;
        if (reducedMotion() || !element.animate) {
          finish();
          return;
        }
        const companions = splitFrames(
          element,
          hostContent(),
          opening,
          interrupted
        );
        motion.start(
          [
            {
              target: element,
              keyframes: [
                { transform },
                { transform: opening ? 'translateX(0)' : 'translateX(100%)' },
              ],
            },
            ...companions,
          ],
          { duration: 220, easing: 'ease-in-out', fill: 'forwards' },
          () => {
            if (current === revision) setPresent(opening);
          },
          () => {
            if (current === revision) setTransitioning(false);
          }
        );
      });
    })
  );
  onCleanup(() => {
    revision += 1;
    motion.cancel();
  });
  return {
    present,
    transitioning,
    finish,
    ref: (node: HTMLDivElement) => {
      element = node;
    },
  };
}
