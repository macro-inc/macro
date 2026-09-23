import { translation } from './affine';
import {
  fitImageCamera,
  INITIAL_CAMERA,
  MAX_SCALE,
  MIN_SCALE,
  zoomAt,
} from './camera';
import type {
  Bounds,
  Camera,
  GraphicsDocument,
  GraphicsItem,
  ImageSurface,
  LegacyRectangle,
  Point,
  RectangleItem,
} from './model';
import {
  children,
  createScene,
  drawableIds,
  freezeDocument,
  groupNodes,
  hitTest,
  reparent,
  ungroupNode,
  worldBounds,
} from './scene';
import { createSelection, type SelectionState } from './selection';

export type EditingSession = SelectionState &
  Readonly<{
    canUndo: boolean;
    canRedo: boolean;
  }>;

export type GraphicsEditor = ReturnType<typeof createGraphicsEditor>;

/** One document and camera per instance. The caller owns disposal. */
export function createGraphicsEditor(
  seed: readonly (LegacyRectangle | GraphicsItem)[] | GraphicsDocument = []
) {
  let document: GraphicsDocument = Array.isArray(seed)
    ? createScene(seed)
    : freezeDocument(seed as GraphicsDocument);
  let camera = INITIAL_CAMERA;
  let disposed = false;
  const listeners = new Set<(camera: Camera) => void>();
  const documentListeners = new Set<(document: GraphicsDocument) => void>();
  const previewListeners = new Set<(preview: Bounds | undefined) => void>();
  const undoStack: GraphicsDocument[] = [];
  const redoStack: GraphicsDocument[] = [];
  const sessionListeners = new Set<(session: EditingSession) => void>();
  const getSession = (): EditingSession =>
    Object.freeze({
      ...selection.getState(),
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    });
  const emitSession = () => {
    for (const listener of sessionListeners) listener(getSession());
  };
  const selection = createSelection({
    getDocument: () => document,
    commitDocument,
    cancelDrawing: cancelRectangle,
    onChange: emitSession,
  });
  const { select, cancelTransform } = selection;
  function commitDocument(next: GraphicsDocument) {
    next = freezeDocument(next);
    undoStack.push(document);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    publishDocument(next);
    emitSession();
  }
  function travel(from: GraphicsDocument[], to: GraphicsDocument[]) {
    if (disposed) return;
    cancelRectangle();
    cancelTransform();
    const next = from.pop();
    if (next) {
      to.push(document);
      publishDocument(next);
    }
    emitSession();
  }
  let start: Point | undefined;
  let preview: Bounds | undefined;

  function setPreview(next: Bounds | undefined) {
    preview = next ? Object.freeze(next) : undefined;
    for (const listener of previewListeners) listener(preview);
  }
  function cancelRectangle() {
    start = undefined;
    setPreview(undefined);
  }
  function publishDocument(next: GraphicsDocument) {
    selection.reconcile(next);
    document = Object.freeze(next);
    for (const listener of documentListeners) listener(document);
  }
  function clampPoint(point: Point): Point {
    const surface = document.surface;
    return surface
      ? {
          x: Math.max(0, Math.min(surface.width, point.x)),
          y: Math.max(0, Math.min(surface.height, point.y)),
        }
      : point;
  }
  function updateRectangle(point: Point) {
    if (
      disposed ||
      !start ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    )
      return;
    const end = clampPoint(point);
    setPreview({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    });
  }

  function publish(next: Camera) {
    if (disposed || ![next.x, next.y, next.scale].every(Number.isFinite))
      return;
    if (
      next.x === camera.x &&
      next.y === camera.y &&
      next.scale === camera.scale
    )
      return;
    camera = Object.freeze(next);
    cancelRectangle();
    cancelTransform();
    for (const listener of listeners) listener(camera);
  }

  return {
    get document() {
      return document;
    },
    getSession,
    subscribeSession(listener: (session: EditingSession) => void) {
      if (disposed) return () => {};
      sessionListeners.add(listener);
      return () => {
        sessionListeners.delete(listener);
      };
    },
    select,
    hitTest: (point: Point, deep = false) => hitTest(document, point, deep),
    groupSelection(id: string) {
      if (disposed) return;
      commitDocument(
        groupNodes(document, selection.getState().selectedIds, id)
      );
      select(id);
    },
    ungroupSelection() {
      if (disposed) return;
      const id = selection.getState().selectedId;
      if (id) commitDocument(ungroupNode(document, id));
    },
    reparent(id: string, parentId: string, order: number) {
      if (!disposed) commitDocument(reparent(document, id, parentId, order));
    },
    toggleSelection: selection.toggle,
    beginBoxSelection: selection.beginBox,
    updateBoxSelection: selection.updateBox,
    commitBoxSelection: selection.commitBox,
    beginTransform: selection.beginTransform,
    updateTransform: selection.updateTransform,
    cancelTransform,
    commitTransform: selection.commitTransform,
    deleteSelection: selection.deleteSelection,
    undo: () => travel(undoStack, redoStack),
    redo: () => travel(redoStack, undoStack),
    getPreview: () => preview,
    subscribeDocument(listener: (document: GraphicsDocument) => void) {
      if (disposed) return () => {};
      documentListeners.add(listener);
      return () => {
        documentListeners.delete(listener);
      };
    },
    subscribePreview(listener: (preview: Bounds | undefined) => void) {
      if (disposed) return () => {};
      previewListeners.add(listener);
      return () => {
        previewListeners.delete(listener);
      };
    },
    setImageSurface(surface: ImageSurface) {
      if (disposed) return;
      if (
        ![surface.width, surface.height].every(
          (value) => Number.isFinite(value) && value > 0
        )
      )
        throw new Error('Invalid image dimensions');
      select();
      undoStack.length = 0;
      redoStack.length = 0;
      emitSession();
      publishDocument({
        ...createScene(),
        surface: Object.freeze({ ...surface }),
      });
    },
    fitScene(viewport: { width: number; height: number }) {
      const bounds = worldBounds(document, document.rootId);
      if (
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        viewport.width <= 0 ||
        viewport.height <= 0
      )
        return;
      const scale = Math.max(
        MIN_SCALE,
        Math.min(
          1,
          (viewport.width - 48) / bounds.width,
          Math.max(1, viewport.height - 64) / bounds.height
        )
      );
      publish({
        scale,
        x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
        y: 44 - bounds.y * scale,
      });
    },
    fitImage(viewport: { width: number; height: number }) {
      if (document.surface) publish(fitImageCamera(document.surface, viewport));
    },
    centerImage(
      viewport: { width: number; height: number },
      scale = camera.scale
    ) {
      const surface = document.surface;
      if (
        !surface ||
        ![viewport.width, viewport.height, scale].every(Number.isFinite)
      )
        return;
      const boundedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
      publish({
        x: (viewport.width - surface.width * boundedScale) / 2,
        y: (viewport.height - surface.height * boundedScale) / 2,
        scale: boundedScale,
      });
    },
    beginRectangle(point: Point) {
      if (disposed || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        return false;
      const surface = document.surface;
      if (
        surface &&
        (point.x < 0 ||
          point.y < 0 ||
          point.x > surface.width ||
          point.y > surface.height)
      )
        return false;
      select();
      start = { ...point };
      updateRectangle(point);
      return true;
    },
    updateRectangle,
    cancelRectangle,
    commitRectangle(
      id: string,
      appearance: RectangleItem['appearance'],
      minSize = 0
    ) {
      const geometry = preview;
      cancelRectangle();
      if (
        disposed ||
        !geometry ||
        geometry.width <= minSize ||
        geometry.height <= minSize
      )
        return false;
      if (Object.hasOwn(document.items, id))
        throw new Error(`Duplicate graphics item: ${id}`);
      const item: RectangleItem = Object.freeze({
        id,
        type: 'rectangle',
        placement: {
          parentId: document.rootId,
          order: children(document).length
            ? Math.max(
                ...children(document).map((id) => {
                  const n = document.items[id];
                  return n && n.type !== 'surface' ? n.placement.order : 0;
                })
              ) + 1
            : 0,
        },
        transform: translation(geometry.x, geometry.y),
        geometry: { width: geometry.width, height: geometry.height },
        appearance: Object.freeze({ ...appearance }),
      });
      commitDocument({
        ...document,
        items: Object.freeze({ ...document.items, [id]: item }),
      });
      return true;
    },
    clearRectangles() {
      if (disposed || !drawableIds(document).length) return;
      select();
      commitDocument({
        ...document,
        items: { [document.rootId]: { id: document.rootId, type: 'surface' } },
      });
    },
    getCamera: () => camera,
    subscribeCamera(listener: (camera: Camera) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    panBy(delta: Point) {
      publish({ ...camera, x: camera.x + delta.x, y: camera.y + delta.y });
    },
    zoomAt(anchor: Point, scale: number) {
      publish(zoomAt(camera, anchor, scale));
    },
    resetCamera() {
      publish(INITIAL_CAMERA);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      documentListeners.clear();
      previewListeners.clear();
      sessionListeners.clear();
      undoStack.length = 0;
      redoStack.length = 0;
      selection.dispose();
      start = undefined;
      preview = undefined;
    },
  };
}
