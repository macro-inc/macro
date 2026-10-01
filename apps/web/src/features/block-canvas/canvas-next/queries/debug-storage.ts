import {
  type Camera,
  freezeDocument,
  type GraphicsDocument,
  type GraphicsEditor,
  MAX_SCALE,
  MIN_SCALE,
} from '@macro-inc/graphics';
import { validCanvasTextDocument } from '../core/text-codec';

export const CANVAS_DEBUG_STORAGE_KEY = 'macro.canvas-next.debug.v1';
type Snapshot = { version: 1; document: GraphicsDocument; camera: Camera };

/** Debug-only browser persistence; the production document backend remains separate. */
export function attachDebugStorage(
  editor: GraphicsEditor,
  storage: () => Pick<Storage, 'getItem' | 'setItem'>,
  onError: () => void
) {
  let restored = false;
  try {
    const raw = storage().getItem(CANVAS_DEBUG_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Snapshot;
      if (saved.version !== 1) throw new Error('Unsupported debug snapshot');
      const document = freezeDocument(saved.document);
      if (!validCanvasTextDocument(document))
        throw new Error('Invalid canvas text');
      const camera = saved.camera;
      if (
        !camera ||
        ![camera.x, camera.y, camera.scale].every(Number.isFinite) ||
        camera.scale < MIN_SCALE ||
        camera.scale > MAX_SCALE
      )
        throw new Error('Invalid camera');
      editor.resetDocument(document);
      editor.resetCamera();
      editor.zoomAt({ x: 0, y: 0 }, camera.scale);
      editor.panBy({ x: camera.x, y: camera.y });
      restored = true;
    }
  } catch {
    onError();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = true;
  const flush = () => {
    clearTimeout(timer);
    if (!dirty) return;
    try {
      const snapshot: Snapshot = {
        version: 1,
        document: editor.document,
        camera: editor.getCamera(),
      };
      storage().setItem(CANVAS_DEBUG_STORAGE_KEY, JSON.stringify(snapshot));
      dirty = false;
    } catch {
      onError();
    }
  };
  const schedule = () => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 200);
  };
  const stopDocument = editor.subscribeDocument(schedule);
  const stopCamera = editor.subscribeCamera(schedule);
  flush();
  return {
    restored,
    flush,
    dispose() {
      stopDocument();
      stopCamera();
      flush();
    },
  };
}
