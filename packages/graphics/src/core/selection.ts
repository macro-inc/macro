import {
  around,
  enclosing,
  inverse,
  multiply,
  rotation,
  sameMatrix,
  scaling,
  transformPoint,
  translation,
} from './affine';
import type { Bounds, GraphicsDocument, GraphicsItem, Point } from './model';
import {
  boxHits,
  deleteSubtrees,
  nodeCorners,
  roots,
  type SceneOverrides,
  worldBounds,
  worldMatrix,
} from './scene';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
export type TransformHandle = ResizeCorner | 'rotate';
export type SelectionState = Readonly<{
  selectedId?: string;
  selectedIds: readonly string[];
  box?: Bounds;
  transform?: Readonly<{
    id: string;
    kind: 'move' | 'resize' | 'scale' | 'rotate';
    geometry: Bounds;
    geometries: Readonly<Record<string, Bounds>>;
    nodes: SceneOverrides;
  }>;
}>;
export type SelectionHost = Readonly<{
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
        pivot: Point;
        nodes: SceneOverrides;
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
            kind:
              gesture.handle === 'rotate'
                ? 'rotate'
                : gesture.handle
                  ? gesture.targets.length > 1 ||
                    gesture.base.items[gesture.id]?.type === 'group'
                    ? 'scale'
                    : 'resize'
                  : 'move',
            geometry: worldBounds(gesture.base, gesture.id, gesture.nodes),
            geometries: Object.freeze(geometries),
            nodes: gesture.nodes,
          })
        : undefined,
    });
  };
  function cancelTransform() {
    if (disposed) return;
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
  function updateTransform(point: Point) {
    if (disposed || !gesture || ![point.x, point.y].every(Number.isFinite))
      return;
    const { base, origin, handle, pivot, targets, id } = gesture;
    const node = base.items[id];
    const nodes: Record<string, GraphicsItem> = Object.create(null);
    if (
      handle &&
      handle !== 'rotate' &&
      (targets.length > 1 || node?.type === 'group')
    ) {
      const bounds = enclosing(
        targets.flatMap((key) => nodeCorners(base, key))
      );
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const west = handle.endsWith('w'),
        north = handle.startsWith('n');
      const anchor = {
        x: west ? bounds.x + bounds.width : bounds.x,
        y: north ? bounds.y + bounds.height : bounds.y,
      };
      // Keep the drag's initial handle offset and avoid singular/flipped scales.
      const sx = Math.max(
        0.01,
        1 + ((west ? -1 : 1) * (point.x - origin.x)) / bounds.width
      );
      const sy = Math.max(
        0.01,
        1 + ((north ? -1 : 1) * (point.y - origin.y)) / bounds.height
      );
      // Nonuniform world scaling shears rotated descendants. Keep their aspect
      // ratio, and that of persistent groups; flat unrotated rectangles may stretch.
      const proportional = targets.some((key) => {
        const item = base.items[key];
        if (!item || item.type === 'surface') return false;
        const world = worldMatrix(base, key);
        return (
          item.type === 'group' ||
          item.placement.parentId !== base.rootId ||
          Math.abs(world[1]) > 1e-9 ||
          Math.abs(world[2]) > 1e-9 ||
          world[0] < 0 ||
          world[3] < 0
        );
      });
      const factor = Math.max(sx, sy);
      const delta = around(
        anchor,
        proportional ? scaling(factor) : scaling(sx, sy)
      );
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
    } else if (handle && handle !== 'rotate') {
      if (node?.type !== 'rectangle') return;
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
      const fixed = {
        x: handle.endsWith('w') ? node.geometry.width : 0,
        y: handle.startsWith('n') ? node.geometry.height : 0,
      };
      const moving = {
        x: (handle.endsWith('w') ? 0 : node.geometry.width) + end.x - start.x,
        y:
          (handle.startsWith('n') ? 0 : node.geometry.height) + end.y - start.y,
      };
      const x = Math.min(fixed.x, moving.x),
        y = Math.min(fixed.y, moving.y);
      const width = Math.abs(fixed.x - moving.x),
        height = Math.abs(fixed.y - moving.y);
      // A zero-sized preview is ignored; no singular shape is committed.
      if (width <= 1e-8 || height <= 1e-8) return;
      nodes[id] = {
        ...node,
        transform: multiply(node.transform, translation(x, y)),
        geometry: { width, height },
      };
    } else {
      let dx = point.x - origin.x,
        dy = point.y - origin.y;
      if (!handle && base.surface) {
        const bounds = enclosing(
          targets.flatMap((key) => nodeCorners(base, key))
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
      const delta =
        handle === 'rotate'
          ? around(
              pivot,
              rotation(
                Math.atan2(point.y - pivot.y, point.x - pivot.x) -
                  Math.atan2(origin.y - pivot.y, origin.x - pivot.x)
              )
            )
          : translation(dx, dy);
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
      nodes[id] = Object.freeze({
        ...node,
        transform: Object.freeze([...node.transform]) as typeof node.transform,
        ...(node.type === 'rectangle'
          ? { geometry: Object.freeze({ ...node.geometry }) }
          : {}),
      });
    }
    gesture = { ...gesture, nodes: Object.freeze(nodes) };
    emit();
  }
  return {
    getState,
    select,
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
    beginTransform(id: string, point: Point, handle?: TransformHandle) {
      const base = host.getDocument(),
        node = base.items[id];
      if (
        disposed ||
        !node ||
        node.type === 'surface' ||
        ![point.x, point.y].every(Number.isFinite)
      )
        return false;
      if (!selectedIds.includes(id)) select(id);
      else {
        cancelTransform();
        host.cancelDrawing();
      }
      const targets = roots(base, selectedIds);
      const bounds = enclosing(
        targets.flatMap((key) => nodeCorners(base, key))
      );
      gesture = {
        id,
        origin: { ...point },
        handle,
        base,
        targets,
        pivot: {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        },
        nodes: Object.freeze({}),
      };
      emit();
      return true;
    },
    commitTransform() {
      if (disposed || !gesture) return false;
      const { base, nodes } = gesture;
      gesture = undefined;
      const changed = Object.entries(nodes).some(([id, node]) => {
        const old = base.items[id];
        if (!old || old.type === 'surface' || node.type === 'surface')
          return false;
        return (
          !sameMatrix(old.transform, node.transform) ||
          (old.type === 'rectangle' &&
            node.type === 'rectangle' &&
            (Math.abs(old.geometry.width - node.geometry.width) > 1e-9 ||
              Math.abs(old.geometry.height - node.geometry.height) > 1e-9))
        );
      });
      if (!changed) {
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
