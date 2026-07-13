import { createBlockSignal } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { unwrap } from 'solid-js/store';
import { OPERATION_LOGGING } from '../constants';
import type { PencilNode } from '../model/CanvasModel';
import { useCachedStyle } from '../signal/cachedStyle';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useSelection } from '../signal/selection';
import { highestOrderSignal, useCanvasNodes } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { sharedInstance } from '../util/sharedInstance';
import { simplify } from '../util/simplify';
import { type Vector2, vec2 } from '../util/vector2';
import type { Operation, Operator } from './operation';

type Coords = Vector2[];

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[Pencil] ${message}`, 'color: green');
}

export type PencilOperation = Operation & {
  type: 'pencil';
  node: PencilNode;
  coords: Coords;
};

function cleanUpLine(coords: Coords): [number, number][] {
  const simplified = simplify(coords, 0.25, false);
  return simplified.map(({ x, y }) => [x, y]);
}

export const currentPencilOperationSignal =
  createBlockSignal<PencilOperation>();

export const usePencil = sharedInstance((): Operator => {
  const { pageToCanvas } = useRenderState();
  const { deselectNode } = useSelection();
  const { createNode, updateNode, ...nodes } = useCanvasNodes();
  const history = useCanvasHistory();
  const cachedStyle = useCachedStyle();
  const [currentPencilOperation, setCurrentPencilOperation] =
    currentPencilOperationSignal;
  const highestOrder = highestOrderSignal.get;

  function _calculateDimensions(coords: [number, number][]) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of coords) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  //claude slop
  function _updateCoords(mousePos: Vector2) {
    const op = currentPencilOperation();
    if (!op) return;

    const newCoords = [...op.coords, vec2(mousePos.x, mousePos.y)];
    // Don't simplify during preview, just use raw coords
    const dimensions = _calculateDimensions(
      newCoords.map(({ x, y }) => [x, y])
    );

    updateNode(op.node.id, {
      coords: newCoords.map(({ x, y }) => [x, y]), // Use raw coords
      width: dimensions.width,
      height: dimensions.height,
    });

    op.coords = newCoords;
  }

  return {
    reset() {
      _log('reset');
      setCurrentPencilOperation();
      nodes.clearPreview();
    },

    start(e: PointerEvent) {
      _log('start');
      history.open();
      const mousePos = pageToCanvas(e);
      const initialCoords = [vec2(mousePos.x, mousePos.y)];

      const node = createNode(
        {
          type: 'pencil',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          edges: [],
          coords: initialCoords,
          style: cachedStyle.getStyle(),
          wScale: 1,
          hScale: 1,
          layer: 0,
          sortOrder: highestOrder() + 1,
        },
        { preview: true, selectOnCreate: false }
      ) as PencilNode;

      setCurrentPencilOperation({
        type: 'pencil',
        timeStamp: Date.now(),
        node,
        coords: initialCoords,
      });
    },

    commit(e: PointerEvent) {
      const op = currentPencilOperation();
      if (!op) return;
      _log('commit');

      const mousePos = pageToCanvas(e);
      let finalCoords = [...op.coords, vec2(mousePos.x, mousePos.y)];
      const line = cleanUpLine(finalCoords);
      const dimensions = _calculateDimensions(line);

      const finalLine = line.map(([x, y]) => [
        x - dimensions.x,
        y - dimensions.y,
      ]) as [number, number][];

      const { id: _, ...newNode } = JSON.parse(JSON.stringify(unwrap(op.node)));
      createNode(
        {
          ...newNode,
          coords: finalLine,
          ...dimensions,
        },
        { autosave: true }
      );

      setCurrentPencilOperation();
      nodes.clearPreview();
      history.close();
    },

    abort() {
      const op = currentPencilOperation();
      if (!op) return;
      _log('abort');
      setCurrentPencilOperation();
      deselectNode(op.node.id);
      nodes.clearPreview();
    },

    preview(e: PointerEvent) {
      if (!currentPencilOperation()) return;
      _log('preview');
      const mousePos = pageToCanvas(e);
      _updateCoords(mousePos);
    },

    active() {
      const op = currentPencilOperation();
      return !!op;
    },
  };
});
