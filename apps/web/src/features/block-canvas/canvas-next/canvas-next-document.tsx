import type { GraphicsEditor } from '@macro-inc/graphics';
import { debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import type { CanvasDocumentProps } from '../component/CanvasDocument';
import {
  fetchCanvasViewLocation,
  saveCanvasViewLocation,
} from '../queries/canvas-document';
import { createNumericParser } from '../util/parse';
import { CanvasNextEditor } from './canvas-next';
import { CanvasAncestry } from './context/canvas-ancestry';
import type { CanvasFile } from './core/document-format';
import { createDocumentPersistence } from './primitives/create-document-persistence';
import { canvasDocumentSource } from './queries/document';

const parseLocation = createNumericParser<{
  x?: number;
  y?: number;
  scale?: number;
}>({
  x: ['x', 'canvas_x'],
  y: ['y', 'canvas_y'],
  scale: ['s', 'scale', 'canvas_scale'],
});

export default function CanvasNextDocument(
  props: CanvasDocumentProps & { initial: CanvasFile }
) {
  const ancestors = useContext(CanvasAncestry);
  const documentId = props.documentId;
  const initial = props.initial;
  const canEdit = () => props.canEdit && !props.isNested;
  const activePointers = new Set<number>();
  const [persistence, setPersistence] =
    createSignal<ReturnType<typeof createDocumentPersistence>>();
  const [editor, setEditor] = createSignal<GraphicsEditor>();
  const [savedLocation] = createResource(async () =>
    props.isNested || props.view ? null : fetchCanvasViewLocation(documentId)
  );
  const location = () =>
    props.view ?? parseLocation(props.locationParams ?? {}) ?? savedLocation();
  const applyLocation = (
    view: { x?: number; y?: number; scale?: number } | null | undefined
  ) => {
    const current = editor();
    if (!current || !view) return;
    const camera = current.getCamera();
    const scale =
      view.scale != null && Number.isFinite(view.scale) && view.scale > 0
        ? view.scale / 100
        : camera.scale;
    current.zoomAt({ x: 0, y: 0 }, scale);
    const next = current.getCamera();
    current.panBy({
      x: Number.isFinite(view.x) ? view.x! - next.x : 0,
      y: Number.isFinite(view.y) ? view.y! - next.y : 0,
    });
  };
  createEffect(() => applyLocation(location()));
  const currentLocation = () => {
    const camera = editor()?.getCamera() ?? { x: 0, y: 0, scale: 1 };
    return {
      x: Math.round(camera.x),
      y: Math.round(camera.y),
      s: Math.round(camera.scale * 100),
    };
  };
  const content = (
    <div
      class="relative flex size-full min-h-0 flex-col"
      on:pointerdown={(event) => activePointers.add(event.pointerId)}
    >
      <Show when={!savedLocation.loading}>
        <CanvasAncestry.Provider value={[...ancestors, documentId]}>
          <CanvasNextEditor
            initial={initial}
            canEdit={props.canEdit}
            isEmbedded={props.isNested}
            fitOnLoad={!location()}
            onReady={(current, finishText) => {
              setEditor(current);
              const saving = createDocumentPersistence(
                current,
                initial,
                canvasDocumentSource(documentId, canEdit)
              );
              setPersistence(saving);
              props.registerMethods?.({
                exportCanvas: async () => {
                  if (canEdit()) finishText();
                  return { ...initial, document: current.document };
                },
                goToLocationFromParams: (params) =>
                  applyLocation(parseLocation(params)),
              });
              let viewTimer: ReturnType<typeof setTimeout> | undefined;
              let notifiedCamera = current.getCamera();
              // Updating the host's saved view can replace its decorator DOM.
              // Wait until navigation settles, and never interrupt a pointer gesture.
              const notifyLocation = debounce(() => {
                if (activePointers.size) return;
                const camera = current.getCamera();
                if (
                  camera.x === notifiedCamera.x &&
                  camera.y === notifiedCamera.y &&
                  camera.scale === notifiedCamera.scale
                )
                  return;
                notifiedCamera = camera;
                props.onLocationChange?.({
                  x: camera.x,
                  y: camera.y,
                  scale: camera.scale * 100,
                });
              }, 100);
              const pointerEnd = (event: PointerEvent) => {
                if (!activePointers.delete(event.pointerId)) return;
                notifyLocation();
              };
              window.addEventListener('pointerup', pointerEnd, true);
              window.addEventListener('pointercancel', pointerEnd, true);
              const unsubscribe = current.subscribeCamera((camera) => {
                notifyLocation();
                if (props.isNested) return;
                clearTimeout(viewTimer);
                viewTimer = setTimeout(() => {
                  void saveCanvasViewLocation(documentId, camera);
                }, 500);
              });
              const flush = () => {
                if (canEdit()) finishText();
                void saving.flush();
              };
              const beforeUnload = (event: BeforeUnloadEvent) => {
                flush();
                if (saving.dirty()) {
                  event.preventDefault();
                  event.returnValue = '';
                }
              };
              window.addEventListener('pagehide', flush);
              window.addEventListener('beforeunload', beforeUnload);
              onCleanup(() => {
                flush();
                saving.dispose();
                unsubscribe();
                notifyLocation.clear();
                window.removeEventListener('pointerup', pointerEnd, true);
                window.removeEventListener('pointercancel', pointerEnd, true);
                clearTimeout(viewTimer);
                window.removeEventListener('pagehide', flush);
                window.removeEventListener('beforeunload', beforeUnload);
              });
            }}
          />
        </CanvasAncestry.Provider>
      </Show>
    </div>
  );
  return props.children
    ? props.children(content, {
        mode: 'next',
        savedFile: () => persistence()?.savedFile(),
        location: currentLocation,
      })
    : content;
}
