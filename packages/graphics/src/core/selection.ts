import {
  around,
  corners,
  enclosing,
  inverse,
  multiply,
  rotation,
  sameMatrix,
  scaling,
  transformPoint,
  translation,
} from './affine';
import { duplicateNodes, type IdFactory } from './fragments';
import type { Bounds, GraphicsDocument, GraphicsItem, Point } from './model';
import {
  dragRectangleRadius,
  isRadiusHandle,
  type RadiusHandle,
} from './radius';
import { type ResizeHandle, type ResizeModifiers, resizeBox } from './resize';
import {
  boxHits,
  deleteSubtrees,
  nodeBoundsPoints,
  resolvedShape,
  roots,
  type SceneOverrides,
  worldBounds,
  worldMatrix,
} from './scene';
import { type SelectionFrame, selectionFrame } from './selection-frame';
import { isShape, shapeDefinition, shapePayload } from './shapes/registry';
import type { TextMeasurer } from './shapes/text';
import { snapTranslation } from './snapping';
import { regenerateScaledShapes, stretchShapes } from './stretch';

export type {
  ResizeCorner,
  ResizeEdge,
  ResizeHandle,
  ResizeModifiers,
} from './resize';
export type TransformHandle = ResizeHandle | RadiusHandle | 'rotate';
export type TransformModifiers = ResizeModifiers &
  Readonly<{ snapRotation?: boolean; constrainAxis?: boolean }>;
export type SelectionState = Readonly<{
  selectedId?: string;
  selectedIds: readonly string[];
  box?: Bounds;
  transform?: Readonly<{
    id: string;
    kind: 'move' | 'resize' | 'scale' | 'rotate' | 'radius';
    handle?: TransformHandle;
    geometry: Bounds;
    geometries: Readonly<Record<string, Bounds>>;
    nodes: SceneOverrides;
    document?: GraphicsDocument;
  }>;
}>;
export type SelectionHost = Readonly<{
  measureText?: TextMeasurer;
  getSnapUnit?: () => number | undefined;
  getDocument: () => GraphicsDocument;
  commitDocument: (document: GraphicsDocument) => void;
  cancelDrawing: () => void;
  onChange: () => void;
}>;

export function createSelection(host: SelectionHost) {
  let disposed = false;
  let selectedIds: readonly string[] = Object.freeze([]);
  let box:
    | {
        origin: Point;
        bounds: Bounds;
        previous: readonly string[];
        additive: boolean;
      }
    | undefined;
  let gesture:
    | {
        id: string;
        origin: Point;
        handle?: TransformHandle;
        base: GraphicsDocument;
        targets: readonly string[];
        frame: SelectionFrame;
        pivot: Point;
        nodes: SceneOverrides;
        originalSelection?: readonly string[];
      }
    | undefined;
  const emit = () => host.onChange();
  const getState = (): SelectionState => {
    const geometries: Record<string, Bounds> = Object.create(null);
    if (gesture)
      for (const id of gesture.targets)
        geometries[id] = worldBounds(gesture.base, id, gesture.nodes);
    return Object.freeze({
      selectedId: selectedIds.length === 1 ? selectedIds[0] : undefined,
      selectedIds,
      box: box?.bounds,
      transform: gesture
        ? Object.freeze({
            id: gesture.id,
            handle: gesture.handle,
            kind: isRadiusHandle(gesture.handle)
              ? 'radius'
              : gesture.handle === 'rotate'
                ? 'rotate'
                : gesture.handle
                  ? gesture.targets.length > 1 ||
                    gesture.base.items[gesture.id]?.type === 'group'
                    ? 'scale'
                    : 'resize'
                  : 'move',
            geometry:
              geometries[gesture.id] ??
              worldBounds(gesture.base, gesture.id, gesture.nodes),
            geometries: Object.freeze(geometries),
            nodes: gesture.nodes,
            document: gesture.originalSelection ? gesture.base : undefined,
          })
        : undefined,
    });
  };
  function cancelTransform() {
    if (disposed) return;
    if (gesture?.originalSelection) selectedIds = gesture.originalSelection;
    gesture = undefined;
    if (box) selectedIds = box.previous;
    box = undefined;
    emit();
  }
  function select(id?: string) {
    if (disposed) return;
    host.cancelDrawing();
    gesture = undefined;
    box = undefined;
    selectedIds = Object.freeze(
      id &&
        host.getDocument().items[id]?.type &&
        host.getDocument().items[id]?.type !== 'surface'
        ? [id]
        : []
    );
    emit();
  }
  function updateTransform(point: Point, modifiers: TransformModifiers = {}) {
    if (disposed || !gesture || ![point.x, point.y].every(Number.isFinite))
      return;
    const { base, origin, handle, pivot, targets, id, frame } = gesture;
    const node = resolvedShape(base, id) ?? base.items[id];
    const nodes: Record<string, GraphicsItem> = Object.create(null);
    const unit = host.getSnapUnit?.();
    if (isRadiusHandle(handle)) {
      if (node?.type !== 'rectangle') return;
      nodes[id] = dragRectangleRadius(
        node,
        worldMatrix(base, id),
        handle,
        origin,
        point
      );
    } else if (
      handle &&
      handle !== 'rotate' &&
      (targets.length > 1 || node?.type === 'group')
    ) {
      const { bounds } = frame;
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const fromWorld = inverse(frame.transform);
      const start = transformPoint(fromWorld, origin);
      const end = transformPoint(fromWorld, point);
      // Different child axes force uniform scaling for the entire selection,
      // including edge drags. This keeps the dragged box and content in sync.
      const proportional = modifiers.proportional || !frame.canDeform;
      const resized = resizeBox(
        bounds,
        handle,
        {
          x: end.x - start.x,
          y: end.y - start.y,
        },
        {
          ...modifiers,
          proportional,
          snap: unit === undefined ? undefined : { x: unit, y: unit },
        }
      );
      const delta = multiply(
        frame.transform,
        multiply(resized.transform, fromWorld)
      );
      if (!proportional) {
        Object.assign(
          nodes,
          stretchShapes(base, targets, delta, host.measureText, handle)
        );
      } else {
        for (const key of targets) {
          const item = base.items[key];
          if (!item || item.type === 'surface') continue;
          nodes[key] = {
            ...item,
            transform: multiply(
              inverse(worldMatrix(base, item.placement.parentId)),
              multiply(delta, worldMatrix(base, key))
            ),
          };
        }
        regenerateScaledShapes(base, targets, nodes);
      }
    } else if (handle && handle !== 'rotate') {
      if (!isShape(node)) return;
      const definition = shapeDefinition(node.type);
      const localBounds = definition.bounds(node);
      const world = worldMatrix(base, id);
      const surface = base.surface;
      const endWorld = surface
        ? {
            x: Math.max(0, Math.min(surface.width, point.x)),
            y: Math.max(0, Math.min(surface.height, point.y)),
          }
        : point;
      const end = transformPoint(inverse(world), endWorld),
        start = transformPoint(inverse(world), origin);
      const delta = { x: end.x - start.x, y: end.y - start.y };
      const resizeModifiers = {
        ...modifiers,
        ...(node.type === 'text' && handle !== 'e' && handle !== 'w'
          ? { proportional: true, proportionalFit: 'project' as const }
          : {}),
      };
      let resized = resizeBox(localBounds, handle, delta, {
        ...resizeModifiers,
        snap:
          unit === undefined
            ? undefined
            : {
                x: unit / Math.hypot(world[0], world[1]),
                y: unit / Math.hypot(world[2], world[3]),
              },
      });
      if (surface && unit !== undefined) {
        const matrix = multiply(world, resized.transform);
        const outside = corners(localBounds).some((point) => {
          const { x, y } = transformPoint(matrix, point);
          return x < 0 || y < 0 || x > surface.width || y > surface.height;
        });
        // The bounded surface takes priority over a grid step past its edge.
        if (outside)
          resized = resizeBox(localBounds, handle, delta, resizeModifiers);
      }
      const { width, height } = resized.bounds;
      nodes[id] = {
        ...definition.resize(
          node,
          { x: 0, y: 0, width, height },
          { handle, measureText: host.measureText }
        ),
        transform: multiply(
          node.transform,
          multiply(
            resized.transform,
            scaling(1 / Math.abs(resized.scaleX), 1 / Math.abs(resized.scaleY))
          )
        ),
      };
    } else {
      let dx = point.x - origin.x,
        dy = point.y - origin.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      if (!handle && unit !== undefined) {
        // A single shape's frame is local; moving always snaps in world space.
        const anchor =
          targets.length === 1 && isShape(base.items[targets[0]!])
            ? worldBounds(base, targets[0]!)
            : frame.bounds;
        const snapped = snapTranslation(anchor, { x: dx, y: dy }, unit);
        dx = snapped.x;
        dy = snapped.y;
      }
      if (!handle && base.surface) {
        const bounds = enclosing(
          targets.flatMap((key) => nodeBoundsPoints(base, key))
        );
        dx = Math.max(
          -bounds.x,
          Math.min(base.surface.width - bounds.x - bounds.width, dx)
        );
        dy = Math.max(
          -bounds.y,
          Math.min(base.surface.height - bounds.y - bounds.height, dy)
        );
      }
      if (!handle && modifiers.constrainAxis) {
        if (horizontal) dy = 0;
        else dx = 0;
      }
      let delta = translation(dx, dy);
      if (handle === 'rotate') {
        let angle =
          Math.atan2(point.y - pivot.y, point.x - pivot.x) -
          Math.atan2(origin.y - pivot.y, origin.x - pivot.x);
        if (modifiers.snapRotation) {
          const world = worldMatrix(base, id);
          const initialAngle =
            targets.length === 1 ? Math.atan2(world[1], world[0]) : 0;
          const step = Math.PI / 6;
          angle =
            Math.round((initialAngle + angle) / step) * step - initialAngle;
        }
        delta = around(pivot, rotation(angle));
      }
      for (const key of targets) {
        const item = base.items[key];
        if (!item || item.type === 'surface') continue;
        nodes[key] = {
          ...item,
          transform: multiply(
            inverse(worldMatrix(base, item.placement.parentId)),
            multiply(delta, worldMatrix(base, key))
          ),
        };
      }
    }
    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === 'surface') continue;
      const original = base.items[id];
      // Moving and rotating retain the validated, deeply frozen geometry.
      // Cloning it here would invalidate derived ink on every pointer update.
      const unchangedGeometry =
        isShape(node) &&
        isShape(original) &&
        node.type === original.type &&
        node.geometry === original.geometry;
      const transform = Object.freeze([
        ...node.transform,
      ]) as typeof node.transform;
      nodes[id] =
        isShape(node) && !unchangedGeometry
          ? Object.freeze({
              ...node,
              ...shapePayload(node.type, node.geometry),
              transform,
            })
          : Object.freeze({ ...node, transform });
    }
    gesture = { ...gesture, nodes: Object.freeze(nodes) };
    emit();
  }
  return {
    getState,
    select,
    selectMany(ids: readonly string[]) {
      cancelTransform();
      host.cancelDrawing();
      selectedIds = Object.freeze(roots(host.getDocument(), ids));
      emit();
    },
    cancelTransform,
    updateTransform,
    toggle(id: string) {
      if (
        disposed ||
        !Object.hasOwn(host.getDocument().items, id) ||
        id === host.getDocument().rootId
      )
        return;
      cancelTransform();
      host.cancelDrawing();
      selectedIds = Object.freeze(
        selectedIds.includes(id)
          ? selectedIds.filter((key) => key !== id)
          : [...selectedIds, id]
      );
      emit();
    },
    beginBox(point: Point, additive = false) {
      if (disposed || ![point.x, point.y].every(Number.isFinite)) return false;
      cancelTransform();
      host.cancelDrawing();
      box = {
        origin: { ...point },
        bounds: Object.freeze({ ...point, width: 0, height: 0 }),
        previous: selectedIds,
        additive,
      };
      if (!additive) selectedIds = Object.freeze([]);
      emit();
      return true;
    },
    updateBox(point: Point) {
      if (disposed || !box || ![point.x, point.y].every(Number.isFinite))
        return;
      const bounds = Object.freeze({
        x: Math.min(box.origin.x, point.x),
        y: Math.min(box.origin.y, point.y),
        width: Math.abs(point.x - box.origin.x),
        height: Math.abs(point.y - box.origin.y),
      });
      box = { ...box, bounds };
      const hits =
        bounds.width > 0 && bounds.height > 0
          ? boxHits(host.getDocument(), bounds)
          : [];
      selectedIds = Object.freeze([
        ...new Set([...(box.additive ? box.previous : []), ...hits]),
      ]);
      emit();
    },
    commitBox() {
      if (!disposed) {
        box = undefined;
        emit();
      }
    },
    beginTransform(
      id: string,
      point: Point,
      handle?: TransformHandle,
      duplicateId?: IdFactory
    ) {
      let base = host.getDocument(),
        node = base.items[id];
      if (
        disposed ||
        !node ||
        node.type === 'surface' ||
        ![point.x, point.y].every(Number.isFinite)
      )
        return false;
      if (
        isRadiusHandle(handle) &&
        (node.type !== 'rectangle' ||
          (selectedIds.includes(id) && selectedIds.length !== 1))
      )
        return false;
      if (!selectedIds.includes(id)) select(id);
      else {
        cancelTransform();
        host.cancelDrawing();
      }
      let originalSelection: readonly string[] | undefined;
      if (duplicateId && !handle) {
        originalSelection = selectedIds;
        const cloned = duplicateNodes(base, selectedIds, duplicateId, {
          x: 0,
          y: 0,
        });
        base = cloned.document;
        selectedIds = Object.freeze(cloned.selection);
        id = selectedIds[0]!;
      }
      const targets = roots(base, selectedIds);
      const frame = selectionFrame(base, targets);
      if (!frame) return false;
      gesture = {
        id,
        origin: { ...point },
        originalSelection,
        handle,
        base,
        targets,
        frame,
        pivot: frame.center,
        nodes: Object.freeze({}),
      };
      emit();
      return true;
    },
    commitTransform() {
      if (disposed || !gesture) return false;
      const { base, nodes, originalSelection } = gesture;
      gesture = undefined;
      const changed = Object.entries(nodes).some(([id, node]) => {
        const old = base.items[id];
        if (!old || old.type === 'surface' || node.type === 'surface')
          return false;
        return (
          !sameMatrix(old.transform, node.transform) ||
          (isShape(old) &&
            isShape(node) &&
            (!shapeDefinition(node.type).sameGeometry(old, node) ||
              (old.appearance.cornerRadius ?? 0) !==
                (node.appearance.cornerRadius ?? 0)))
        );
      });
      if (!changed) {
        if (originalSelection) selectedIds = originalSelection;
        emit();
        return false;
      }
      host.commitDocument({ ...base, items: { ...base.items, ...nodes } });
      return true;
    },
    deleteSelection() {
      if (disposed || !selectedIds.length) return;
      host.cancelDrawing();
      const next = deleteSubtrees(host.getDocument(), selectedIds);
      selectedIds = Object.freeze([]);
      gesture = undefined;
      box = undefined;
      host.commitDocument(next);
    },
    reconcile(document: GraphicsDocument) {
      if (disposed) return;
      if (gesture?.originalSelection) selectedIds = gesture.originalSelection;
      gesture = undefined;
      box = undefined;
      selectedIds = Object.freeze(
        selectedIds.filter((id) => Object.hasOwn(document.items, id))
      );
    },
    dispose() {
      disposed = true;
      selectedIds = Object.freeze([]);
      gesture = undefined;
      box = undefined;
    },
  };
}
