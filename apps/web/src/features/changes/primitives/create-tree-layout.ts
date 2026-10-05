import type { AnimationTarget } from '@app/lib/utils/create-animation-group';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import { DEFAULT_TREE_WIDTH, MIN_TREE_WIDTH } from './create-pane-layout';

type TreeTransition = { opening: boolean; from: number; interrupted: boolean };
type TreeResizeZone = Pick<ResizeZoneCtx, 'size' | 'sizeOf'>;

/** Pixel geometry and presence for the tree's Resize panel, not its DOM owner. */
export function createTreeLayout(options: {
  visible: Accessor<boolean>;
  width: Accessor<number>;
  dock: Accessor<HTMLElement | undefined>;
  diff: Accessor<HTMLElement | undefined>;
}) {
  const [present, setPresent] = createSignal(options.visible());
  let zone: TreeResizeZone | undefined;
  let finishMotion: (() => void) | undefined;
  let expandedSize = options.width;
  const panel = () =>
    options.dock()?.closest<HTMLElement>('[data-resize-panel]');
  const finish = () => finishMotion?.();

  const companions = ({ opening, from, interrupted }: TreeTransition) => {
    const treePanel = panel();
    const diffPanel = options.diff()?.parentElement;
    const root = treePanel?.parentElement;
    if (!treePanel || !diffPanel || !root) return [];
    const width = zone?.size() ?? root.clientWidth;
    const fromOffset = from > 0 ? from + 1 : 0;
    const toOffset = opening ? expandedSize() + 1 : 0;
    const current = getComputedStyle(diffPanel);
    const frames: AnimationTarget[] = [
      {
        target: diffPanel,
        keyframes: [
          interrupted
            ? { left: current.left, width: current.width }
            : { left: `${fromOffset}px`, width: `${width - fromOffset}px` },
          { left: `${toOffset}px`, width: `${width - toOffset}px` },
        ],
      },
    ];
    const gutter = root.querySelector<HTMLElement>(
      ':scope > [role="separator"]'
    );
    if (gutter) {
      gutter.inert = !opening;
      gutter.setAttribute('aria-hidden', String(!opening));
      const inset = Number.parseFloat(gutter.style.left) - expandedSize();
      frames.push({
        target: gutter,
        keyframes: [
          {
            left:
              interrupted && gutter.getAnimations?.().length
                ? getComputedStyle(gutter).left
                : `${from + inset}px`,
          },
          { left: `${(opening ? expandedSize() : 0) + inset}px` },
        ],
      });
    }
    return frames;
  };

  return {
    present,
    setPresent,
    panel,
    expandedSize: () => expandedSize(),
    drawerWidth: () => {
      const available = zone?.size() ?? DEFAULT_TREE_WIDTH;
      return Math.min(
        DEFAULT_TREE_WIDTH,
        Math.max(Math.min(MIN_TREE_WIDTH, available), available - 32)
      );
    },
    companions,
    finish,
    captureController: (controller: { finish: () => void }) => {
      finishMotion = controller.finish;
    },
    captureZone: (ctx: TreeResizeZone) => {
      if (zone === ctx) return;
      zone = ctx;
      const size = ctx.sizeOf('changes-file-tree');
      expandedSize = createMemo<number>((previous) => {
        const solved = size();
        return options.visible() && solved > 0
          ? solved
          : (previous ?? options.width());
      });
      // Resize invalidates animation endpoints; settle before using new geometry.
      createEffect(on(ctx.size, finish, { defer: true }));
    },
    settle: (event: PointerEvent | KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[role="separator"]')
      ) {
        finish();
      }
    },
  };
}
