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
  Point,
  RectangleItem,
} from './model';

export type GraphicsEditor = ReturnType<typeof createGraphicsEditor>;

/** One document and camera per instance. The caller owns disposal. */
export function createGraphicsEditor(seed: readonly GraphicsItem[] = []) {
  const items: Record<string, GraphicsItem> = {};
  for (const item of seed) {
    if (Object.hasOwn(items, item.id))
      throw new Error(`Duplicate graphics item: ${item.id}`);
    const { x, y, width, height } = item.geometry;
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width < 0 ||
      height < 0
    ) {
      throw new Error(`Invalid graphics geometry: ${item.id}`);
    }
    Object.defineProperty(items, item.id, {
      value: Object.freeze({
        ...item,
        geometry: Object.freeze({ ...item.geometry }),
        appearance: Object.freeze({ ...item.appearance }),
      }),
      enumerable: true,
    });
  }
  let document: GraphicsDocument = Object.freeze({
    version: 1,
    items: Object.freeze(items),
    order: Object.freeze(seed.map((item) => item.id)),
  });
  let camera = INITIAL_CAMERA;
  let disposed = false;
  const listeners = new Set<(camera: Camera) => void>();
  const documentListeners = new Set<(document: GraphicsDocument) => void>();
  const previewListeners = new Set<(preview: Bounds | undefined) => void>();
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
    for (const listener of listeners) listener(camera);
  }

  return {
    get document() {
      return document;
    },
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
      cancelRectangle();
      publishDocument({
        version: 1,
        surface: Object.freeze({ ...surface }),
        items: Object.freeze({}),
        order: Object.freeze([]),
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
        geometry,
        appearance: Object.freeze({ ...appearance }),
      });
      publishDocument({
        ...document,
        items: Object.freeze({ ...document.items, [id]: item }),
        order: Object.freeze([...document.order, id]),
      });
      return true;
    },
    clearRectangles() {
      if (disposed) return;
      cancelRectangle();
      publishDocument({
        ...document,
        items: Object.freeze({}),
        order: Object.freeze([]),
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
      start = undefined;
      preview = undefined;
    },
  };
}
