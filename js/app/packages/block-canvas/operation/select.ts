import { edgeToCollisionData } from '@block-canvas/util/connectors';
import { createBlockSignal } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { OPERATION_LOGGING } from '../constants';
import type { CanvasId, PencilNode } from '../model/CanvasModel';
import { useSelection } from '../signal/selection';
import { useToolManager } from '../signal/toolManager';
import {
  useCanvasEdges,
  useCanvasGroups,
  useCanvasNodes,
  useEdgeUtils,
} from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { Rect } from '../util/rectangle';
import { sharedInstance } from '../util/sharedInstance';
import type { Vector2 } from '../util/vector2';
import type { Operation, Operator } from './operation';

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[Select] ${message}`, 'color: deeppink');
}

export type SelectOperation = Operation & {
  type: 'select';
  initialMousePos: Vector2;
  initialSelectedNodes: CanvasId[];
  initialSelectedEdges: CanvasId[];
};

export const currentSelectOperationSignal =
  createBlockSignal<SelectOperation>();

export const useSelect = sharedInstance((): Operator => {
  const { pageToCanvas } = useRenderState();
  const { setSelectionBox, forceSetSelection } = useSelection();
  const [currentOperation, setCurrentOperation] = currentSelectOperationSignal;
  const nodes = useCanvasNodes();
  const egdes = useCanvasEdges();
  const groups = useCanvasGroups();
  const { getRawEndPoints: getEdgeEndPoints } = useEdgeUtils();
  const toolManager = useToolManager();
  const selection = useSelection();

  function applyMousePos(mousePos: Vector2, opts?: { shiftKey?: boolean }) {
    const op = currentOperation();
    if (!op) return;
    const rect = Rect.fromPoints(op.initialMousePos, mousePos);
    if (rect.width < 1 || rect.height < 1) return;
    setSelectionBox(rect);

    const containedGroupIds = new Set<string>();

    const containedNodeIds = nodes.visible().reduce((acc: string[], node) => {
      const nodeRect = Rect.fromCanvasNode(node);
      if (
        node.type === 'shape' ||
        node.type === 'image' ||
        node.type === 'video' ||
        node.type === 'text' ||
        node.type === 'file'
      ) {
        if (rect.intersects(nodeRect)) {
          acc.push(node.id);
          if (node.groupId) {
            containedGroupIds.add(node.groupId);
            const group = groups.get(node.groupId);
            group.childNodes?.forEach((n) => acc.push(n));
          }
        }
      } else if (node.type === 'pencil') {
        if (Rect.checkPencilIntersection(node as PencilNode, rect)) {
          acc.push(node.id);
          if (node.groupId) {
            containedGroupIds.add(node.groupId);
            const group = groups.get(node.groupId);
            group.childNodes?.forEach((n) => acc.push(n));
          }
        }
      }
      return acc;
    }, []);

    const containedEdgeIds = egdes.visible().reduce((acc: string[], edge) => {
      const endPoints = getEdgeEndPoints(edge);
      const sel = () => {
        acc.push(edge.id);
        if (edge.groupId) {
          containedGroupIds.add(edge.groupId);
          const group = groups.get(edge.groupId);
          group.childEdges?.forEach((e) => acc.push(e));
        }
      };
      if (
        rect.containsPoint(endPoints.from) ||
        rect.containsPoint(endPoints.to)
      ) {
        sel();
      }
      const points = edgeToCollisionData(edge, [endPoints.from, endPoints.to]);
      for (let i = 1; i < points.length; i++) {
        const current = points[i];
        const previous = points[i - 1];
        if (rect.containsPoint(current)) {
          sel();
          break;
        }
        if (Rect.intersectLineSegment(rect, previous, current).length > 0) {
          sel();
          break;
        }
      }
      return acc;
    }, []);

    if (opts?.shiftKey) {
      containedNodeIds.push(...op.initialSelectedNodes);
      containedEdgeIds.push(...op.initialSelectedEdges);
    }

    forceSetSelection(
      containedNodeIds,
      containedEdgeIds,
      Array.from(containedGroupIds)
    );
  }

  return {
    reset() {
      _log('reset');
      setCurrentOperation();
      setSelectionBox();
    },

    start(e: PointerEvent) {
      _log('start');
      setCurrentOperation({
        type: 'select',
        timeStamp: Date.now(),
        initialMousePos: pageToCanvas(e),
        initialSelectedNodes: [...selection.getStashed().nodes],
        initialSelectedEdges: [...selection.getStashed().edges],
      });
    },

    commit(_e: PointerEvent) {
      _log('commit');
      setCurrentOperation();
      setSelectionBox();
    },

    abort() {
      _log('abort');
      setCurrentOperation();
      setSelectionBox();
    },

    preview(e: PointerEvent) {
      if (!currentOperation()) return;
      applyMousePos(pageToCanvas(e), {
        shiftKey: e.shiftKey,
      });
      _log('preview');
    },

    // TODO (seamus) : This is not ideal aesthetically. Active() should always return true if there
    // is an active operation. But see the logic inside of the selectionRenderer - we swtich from
    // showing the selectionRenderer with proper handdles to showing the box select box when the
    // box is bigger than some arbitrary size.
    active() {
      const op = currentOperation();
      if (op === undefined) return false;
      const pos = pageToCanvas({
        pageX: toolManager.mousePosition().x,
        pageY: toolManager.mousePosition().y,
      });
      return (op && op.initialMousePos.distance(pos) > 5) ?? false;
    },
  };
});
