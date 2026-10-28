import { type Accessor, createMemo } from 'solid-js';
import {
  type Bounds,
  type Point,
  type Size,
  unionBounds,
  zoomDetail,
} from '../core/camera';
import type { BoardVariant } from '../core/variants';
import { createBoardCamera } from './board-camera';
import type { BoardMemory } from './board-memory';
import { createNodeDrag } from './node-drag';
import { createNodeSizes } from './node-sizes';

/**
 * One variant's stage: node measurement, its remembered camera, and moving
 * nodes by hand. Nodes the viewer moved leave the variant's layout and stay
 * where they were dropped; the rest flow.
 *
 * `layoutBounds` may read a layout built from `flowing` and `sizes` after
 * the stage is created; it is only read once the board renders.
 */
export function createBoardStage<TNode extends { key: string }>(options: {
  variant: BoardVariant;
  memory: BoardMemory;
  nodes: Accessor<readonly TNode[]>;
  layoutBounds: () => Bounds | undefined;
  /** Size a moved node takes up before it has been measured. */
  fallbackSize: Size;
  maxFitScale?: number;
}) {
  const sizes = createNodeSizes();
  const movedTo = (key: string) =>
    options.memory.position(options.variant, key);

  const flowing = createMemo(() =>
    options.nodes().filter((node) => !movedTo(node.key))
  );
  const moved = createMemo(() =>
    options.nodes().filter((node) => movedTo(node.key))
  );

  const bounds = () =>
    unionBounds([
      ...(options.layoutBounds() ? [options.layoutBounds() as Bounds] : []),
      ...moved().flatMap((node) => {
        const point = movedTo(node.key);
        if (!point) return [];
        return [
          { ...point, ...(sizes.size(node.key) ?? options.fallbackSize) },
        ];
      }),
    ]);

  const camera = createBoardCamera({
    saved: () => options.memory.camera(options.variant),
    bounds,
    onSave: (next) => options.memory.setCamera(options.variant, next),
    maxFitScale: options.maxFitScale,
  });

  const drag = createNodeDrag({
    scale: () => camera.camera().scale,
    onDrop: (key, point) => options.memory.moveTo(options.variant, key, point),
  });

  return {
    sizes,
    camera,
    drag,
    flowing,
    detail: () => zoomDetail(camera.camera().scale),
    /** Where a node is drawn: while dragged, where it was moved, else laid out. */
    place: (key: string, laidOut: Point | undefined): Point | undefined =>
      drag.position(key) ?? movedTo(key) ?? laidOut,
    isMoved: (key: string) => movedTo(key) !== undefined,
  };
}

export type BoardStage = ReturnType<typeof createBoardStage>;
