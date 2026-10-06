import type { GraphicsBackend } from './backend';
import {
  fitImageCamera,
  INITIAL_CAMERA,
  MAX_SCALE,
  MIN_SCALE,
  zoomAt,
} from './camera';
import { type GraphicsCommand, styleCommand } from './commands';
import {
  createDrawing,
  type DrawingKind,
  type DrawingModifiers,
  type DrawingSample,
} from './drawing';
import {
  applyDocumentDelta,
  type DocumentDelta,
  documentDelta,
} from './history';
import { type LayerOperation, reorderNodes } from './layering';
import type {
  Appearance,
  Bounds,
  Camera,
  GraphicsDocument,
  GraphicsItem,
  ImageSurface,
  Point,
} from './model';
import { keysAt, type LayerPosition } from './ordering';
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
import type { TextMeasurer } from './shapes/text';
import { snapPoint, validateSnapUnit } from './snapping';

export type EditingSession = SelectionState &
  Readonly<{
    canUndo: boolean;
    canRedo: boolean;
    snapUnit?: number;
  }>;

export type GraphicsEditorOptions = Readonly<{
  measureText?: TextMeasurer;
  /** Any positive finite scene-unit interval; omitted disables snapping. */
  snapUnit?: number;
}>;
export type GraphicsEditor = ReturnType<typeof createGraphicsEditor>;

/** One document and camera per instance. The caller owns disposal. */
export function createGraphicsEditor(
  seed: readonly GraphicsItem[] | GraphicsDocument = [],
  options: GraphicsEditorOptions = {}
) {
  return createEditor(seed, undefined, options);
}

/** The caller owns the backend lifetime; disposal only detaches this editor. */
export function createGraphicsEditorFromBackend(
  backend: GraphicsBackend,
  options: GraphicsEditorOptions = {}
) {
  return createEditor(backend.getDocument(), backend, options);
}

function createEditor(
  seed: readonly GraphicsItem[] | GraphicsDocument,
  backend?: GraphicsBackend,
  options: GraphicsEditorOptions = {}
) {
  validateSnapUnit(options.snapUnit);
  let snapUnit = options.snapUnit;
  let document: GraphicsDocument = Array.isArray(seed)
    ? createScene(seed)
    : freezeDocument(seed as GraphicsDocument);
  let camera = INITIAL_CAMERA;
  let disposed = false;
  const listeners = new Set<(camera: Camera) => void>();
  const documentListeners = new Set<(document: GraphicsDocument) => void>();
  const previewListeners = new Set<(preview: Bounds | undefined) => void>();
  const undoStack: DocumentDelta[] = [];
  const redoStack: DocumentDelta[] = [];
  const sessionListeners = new Set<(session: EditingSession) => void>();
  const getSession = (): EditingSession =>
    Object.freeze({
      ...selection.getState(),
      snapUnit,
      canUndo: backend ? backend.getHistory().canUndo : undoStack.length > 0,
      canRedo: backend ? backend.getHistory().canRedo : redoStack.length > 0,
    });
  const emitSession = () => {
    const session = getSession();
    for (const listener of sessionListeners) listener(session);
  };
  const selection = createSelection({
    measureText: options.measureText,
    getSnapUnit: () => snapUnit,
    getDocument: () => document,
    commitDocument,
    cancelDrawing: cancelShape,
    onChange: emitSession,
  });
  const { select, cancelTransform } = selection;
  function commitDocument(next: GraphicsDocument) {
    next = freezeDocument(next);
    if (backend) {
      backend.commit(next);
      return;
    }
    const delta = documentDelta(document, next);
    if (!delta) return;
    undoStack.push(delta);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    publishDocument(next);
    emitSession();
  }
  function travel(
    from: DocumentDelta[],
    to: DocumentDelta[],
    direction: 'before' | 'after'
  ) {
    if (disposed) return;
    cancelShape();
    cancelTransform();
    const delta = from.pop();
    if (delta) {
      to.push(delta);
      publishDocument(applyDocumentDelta(document, delta, direction));
    }
    emitSession();
  }
  const drawing = createDrawing();
  let preview: Bounds | undefined;

  const detachBackend = backend?.subscribe((source) => {
    // Until intent rebasing is implemented, remote commits cancel local previews.
    if (source === 'remote') cancelShape();
    publishDocument(backend.getDocument());
    emitSession();
  });

  function setPreview(next: Bounds | undefined) {
    preview = next ? Object.freeze(next) : undefined;
    for (const listener of previewListeners) listener(preview);
  }
  function cancelShape() {
    drawing.cancel();
    setPreview(undefined);
  }
  function publishDocument(next: GraphicsDocument) {
    selection.reconcile(next);
    document = Object.freeze(next);
    for (const listener of documentListeners) listener(document);
  }
  /** Replace disposable working data and clear selection, previews and history. */
  function resetDocument(next: GraphicsDocument) {
    if (disposed) return;
    if (backend)
      throw new Error('Reset shared scenes by recreating their backend');
    const validated = freezeDocument(next);
    select();
    undoStack.length = 0;
    redoStack.length = 0;
    publishDocument(validated);
    emitSession();
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
  function updateShape(point: DrawingSample, modifiers: DrawingModifiers = {}) {
    updateDrawing([point], modifiers);
  }
  function updateDrawing(
    samples: readonly DrawingSample[],
    modifiers: DrawingModifiers = {}
  ) {
    if (disposed) return;
    drawing.update(
      samples.map((sample) => ({
        ...sample,
        ...clampPoint(
          drawing.kind() === 'pencil' ? sample : snapPoint(sample, snapUnit)
        ),
      })),
      modifiers
    );
    setPreview(drawing.bounds());
  }
  function getDrawingPreview(appearance: Appearance) {
    return drawing.item(
      'preview',
      { parentId: document.rootId, sortKey: 'a0' },
      appearance
    );
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
    cancelShape();
    cancelTransform();
    for (const listener of listeners) listener(camera);
  }

  function beginShape(kind: DrawingKind, point: DrawingSample) {
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
    drawing.begin(
      kind,
      kind === 'pencil' ? point : clampPoint(snapPoint(point, snapUnit)),
      document.surface
    );
    setPreview(drawing.bounds());
    return true;
  }
  function commitShape(id: string, appearance: Appearance, minSize = 0) {
    if (disposed) return false;
    const item = drawing.item(
      id,
      {
        parentId: document.rootId,
        sortKey: keysAt(
          document,
          children(document),
          children(document).length,
          1
        )[0]!,
      },
      appearance,
      minSize
    );
    cancelShape();
    if (!item) return false;
    if (Object.hasOwn(document.items, id))
      throw new Error(`Duplicate graphics item: ${id}`);
    commitDocument({
      ...document,
      items: Object.freeze({ ...document.items, [id]: item }),
    });
    return true;
  }

  function execute<Payload>(
    command: GraphicsCommand<Payload>,
    payload: Payload
  ) {
    if (disposed) return;
    // Commands replace any pending gesture and always form one history step.
    cancelShape();
    cancelTransform();
    const result = command.apply(
      {
        document,
        selection: selection.getState().selectedIds,
        snapUnit,
        measureText: options.measureText,
      },
      payload
    );
    if (result.document !== document) commitDocument(result.document);
    if (result.selection) selection.selectMany(result.selection);
  }

  return {
    get document() {
      return document;
    },
    getSession,
    getSnapUnit: () => snapUnit,
    setSnapUnit(unit: number | undefined) {
      validateSnapUnit(unit);
      if (disposed || unit === snapUnit) return;
      snapUnit = unit;
      cancelShape();
      cancelTransform();
    },
    resetDocument,
    subscribeSession(listener: (session: EditingSession) => void) {
      if (disposed) return () => {};
      sessionListeners.add(listener);
      return () => {
        sessionListeners.delete(listener);
      };
    },
    select,
    hitTest: (point: Point, deep = false) =>
      hitTest(document, point, deep, 3 / camera.scale),
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
    reparent(id: string, parentId: string, position: LayerPosition = 'front') {
      if (disposed) return;
      const next = reparent(document, id, parentId, position);
      if (next !== document) commitDocument(next);
    },
    reorderSelection(operation: LayerOperation) {
      if (disposed) return;
      const next = reorderNodes(
        document,
        selection.getState().selectedIds,
        operation
      );
      if (next !== document) commitDocument(next);
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
    execute,
    setSelectionAppearance: (appearance: Partial<Appearance>) =>
      execute(styleCommand, appearance),
    undo: () => {
      if (disposed) return;
      if (!backend) return travel(undoStack, redoStack, 'before');
      cancelShape();
      cancelTransform();
      backend.undo();
    },
    redo: () => {
      if (disposed) return;
      if (!backend) return travel(redoStack, undoStack, 'after');
      cancelShape();
      cancelTransform();
      backend.redo();
    },
    getPreview: () => preview,
    getDrawingPreview,
    updateDrawing,
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
      resetDocument({ ...createScene(), surface });
    },
    fitScene(viewport: { width: number; height: number }) {
      const bounds = worldBounds(document, document.rootId);
      if (
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        ![viewport.width, viewport.height].every(
          (size) => Number.isFinite(size) && size > 0
        )
      )
        return;
      // Screen-space margins; leave usable room even in a small embedded view.
      const padding = Math.min(100, viewport.width / 4, viewport.height / 4);
      const scale = Math.max(
        MIN_SCALE,
        Math.min(
          MAX_SCALE,
          (viewport.width - padding * 2) / bounds.width,
          (viewport.height - padding * 2) / bounds.height
        )
      );
      publish({
        scale,
        x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
        y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
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
    beginShape,
    updateShape,
    cancelShape,
    commitShape,
    getDrawingKind: drawing.kind,
    // Convenience operations for the rectangle-only image markup host.
    beginRectangle: (point: Point) => beginShape('rectangle', point),
    updateRectangle: updateShape,
    cancelRectangle: cancelShape,
    commitRectangle: commitShape,
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
      detachBackend?.();
      listeners.clear();
      documentListeners.clear();
      previewListeners.clear();
      sessionListeners.clear();
      undoStack.length = 0;
      redoStack.length = 0;
      selection.dispose();
      drawing.cancel();
      preview = undefined;
    },
  };
}
