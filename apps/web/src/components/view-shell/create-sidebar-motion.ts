import { createAnimationGroup } from '@app/lib/utils/create-animation-group';
import { type Accessor, onCleanup } from 'solid-js';

const SIDEBAR_MOTION_DURATION = 140;

/** Animate the solver's settled layout without changing its resize preferences. */
export function createSidebarMotion(root: Accessor<HTMLElement | undefined>) {
  const motion = createAnimationGroup();
  let revision = 0;
  let restore = () => {};
  const cancel = () => {
    motion.cancel();
    restore();
    restore = () => {};
  };
  onCleanup(() => {
    revision++;
    cancel();
  });

  return (update: () => void, complete: () => void = () => {}) => {
    const shell = root();
    const currentRevision = ++revision;
    const panels = shell?.querySelectorAll<HTMLElement>(
      ':scope > [data-resize-zone] > [data-resize-panel]'
    );
    const before = new Map(
      Array.from(panels ?? [], (panel) => {
        const style = getComputedStyle(panel);
        return [
          panel,
          {
            width: panel.getBoundingClientRect().width,
            left: style.left,
            opacity: style.display === 'none' ? '0' : style.opacity,
          },
        ] as const;
      })
    );
    cancel();
    update();
    if (
      !shell ||
      typeof shell.animate !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      complete();
      return;
    }

    // Solid settles the solver's registrations before measuring the destination.
    queueMicrotask(() => {
      if (revision !== currentRevision || !shell.isConnected) return;
      const targets: { target: HTMLElement; keyframes: Keyframe[] }[] = [];
      const cleanups: (() => void)[] = [];
      for (const [panel, from] of before) {
        if (!panel.isConnected) continue;
        const aside = panel.querySelector<HTMLElement>(
          '[data-view-shell-aside]'
        );
        const hidden =
          panel.classList.contains('hidden') ||
          getComputedStyle(panel).display === 'none';
        const width = hidden ? 0 : Number.parseFloat(panel.style.width);
        const left = panel.style.left;
        if (from.width === width && from.left === left) continue;

        const previousOverflow = panel.style.overflow;
        const previousDisplay = panel.style.display;
        const previousAsideWidth = aside?.style.width;
        if (aside) {
          // Keep labels and icons at their resting width while their frame closes.
          aside.style.width = `${Math.max(from.width, width)}px`;
          panel.style.overflow = 'clip';
          panel.style.display = 'block';
          cleanups.push(() => {
            aside.style.width = previousAsideWidth ?? '';
            panel.style.overflow = previousOverflow;
            panel.style.display = previousDisplay;
          });
        }
        targets.push({
          target: panel,
          keyframes: [
            {
              width: `${from.width}px`,
              left: from.left,
              opacity: aside ? from.opacity : 1,
            },
            { width: `${width}px`, left, opacity: aside && hidden ? 0 : 1 },
          ],
        });
      }
      restore = () => {
        for (const cleanup of cleanups) cleanup();
      };
      if (!targets.length) {
        restore();
        restore = () => {};
        complete();
        return;
      }
      motion.start(
        targets,
        { duration: SIDEBAR_MOTION_DURATION, easing: 'ease-out', fill: 'both' },
        complete,
        () => {
          restore();
          restore = () => {};
        }
      );
    });
  };
}
