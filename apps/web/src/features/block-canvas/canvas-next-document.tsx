import { useFlow, usePending } from '@app/observability/flow';
import { ENABLE_MENTION_TRACKING } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { GraphicsEditor } from '@macro-inc/graphics';
import {
  createEffect,
  createResource,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { CanvasNextEditor } from './canvas-next';
import type { CanvasDocumentProps } from './component/CanvasDocument';
import { Loading } from './component/Loading';
import { URL_PARAMS } from './constants';
import { CanvasAncestry } from './context/canvas-ancestry';
import { readSharedCanvas } from './core/collaboration';
import type { CanvasFile } from './core/document-format';
import { createNumericParser } from './core/parse';
import type { CanvasFocusRequest } from './core/view';
import { createSharedReferenceTracking } from './primitives/create-shared-reference-tracking';
import {
  fetchCanvasViewLocation,
  saveCanvasViewLocation,
} from './queries/canvas-document';
import { createCanvasSession } from './queries/canvas-session';
import { canvasSyncSource } from './queries/canvas-sync';
import { canvasReferenceSource } from './queries/references';

const parseLocation = createNumericParser<{
  x?: number;
  y?: number;
  scale?: number;
}>({
  x: ['x', 'canvas_x'],
  y: ['y', 'canvas_y'],
  scale: ['s', 'scale', 'canvas_scale'],
});

function parseFocus(
  params: Record<string, unknown>
): CanvasFocusRequest | undefined {
  const value = params[URL_PARAMS.item];
  const itemId = Array.isArray(value) ? value[0] : value;
  return typeof itemId === 'string' && itemId ? { itemId } : undefined;
}

export default function CanvasNextDocument(
  props: CanvasDocumentProps & { initial: CanvasFile }
) {
  const [attempt, setAttempt] = createSignal(1);
  return (
    <Show when={attempt()} keyed>
      {(_attempt) => (
        <CanvasDocumentSession
          {...props}
          retry={() => setAttempt((value) => value + 1)}
        />
      )}
    </Show>
  );
}

function CanvasDocumentSession(
  props: CanvasDocumentProps & { initial: CanvasFile; retry: () => void }
) {
  const ancestors = useContext(CanvasAncestry);
  const documentId = props.documentId;
  const initial = props.initial;
  const userId = useUserId();
  const openedBy = userId();
  const flow = useFlow();
  const sync = canvasSyncSource(documentId, userId, flow.span);
  const canEdit = () =>
    props.canEdit &&
    !props.isNested &&
    userId() === openedBy &&
    sync.canWrite();
  const session = flow.span.run(() =>
    createCanvasSession({
      documentId,
      span: flow.span,
      initial,
      requireShared: props.shared,
      userId: userId(),
      canEdit,
      ...sync,
    })
  );
  usePending('canvas.sync', () => session.state().t === 'loading');
  const sharedDoc = () => {
    const state = session.state();
    return state.t === 'ready' ? state.doc : undefined;
  };
  const error = () => {
    const state = session.state();
    return state.t === 'error' ? state.message : session.failure();
  };
  const [revision, setRevision] = createSignal(0);
  const [editor, setEditor] = createSignal<GraphicsEditor>();
  const [savedLocation] = createResource(async () =>
    props.isNested || props.view ? null : fetchCanvasViewLocation(documentId)
  );
  const [focus, setFocus] = createSignal(
    parseFocus(props.locationParams ?? {})
  );
  // A link to an item frames that item, not the view saved from last time.
  const location = () =>
    props.view ??
    parseLocation(props.locationParams ?? {}) ??
    (focus() ? undefined : savedLocation());
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
  const renderEditor = (doc?: import('loro-crdt').LoroDoc) => (
    <div class="relative flex size-full min-h-0 flex-col">
      <Show when={!savedLocation.loading}>
        <CanvasAncestry.Provider value={[...ancestors, documentId]}>
          <CanvasNextEditor
            documentId={documentId}
            initial={initial}
            doc={doc}
            session={doc ? session : undefined}
            displayName={(userId) =>
              getDisplayName(tryMacroId(userId ?? ''), {
                emailFallback: 'local-part',
              }) || 'Someone'
            }
            canEdit={!!doc && canEdit()}
            isEmbedded={props.isNested}
            fitOnLoad={!location()}
            focus={focus}
            onReady={(current, finishText) => {
              setEditor(current);
              if (doc)
                session.finishEditing(() => {
                  if (canEdit()) finishText();
                });
              const detachDocument = current.subscribeDocument(() =>
                setRevision((value) => value + 1)
              );
              if (doc && ENABLE_MENTION_TRACKING)
                createSharedReferenceTracking(
                  doc,
                  documentId,
                  canEdit,
                  session.flush,
                  canvasReferenceSource(documentId)
                );
              props.registerMethods?.({
                exportCanvas: async () => {
                  if (props.shared && !doc)
                    throw new Error('Shared Canvas content is not loaded');
                  if (canEdit()) finishText();
                  return doc
                    ? readSharedCanvas(doc, documentId)
                    : { ...initial, document: current.document };
                },
                goToLocationFromParams: (params) => {
                  const request = parseFocus(params);
                  if (request) setFocus(request);
                  else applyLocation(parseLocation(params));
                },
              });
              let viewTimer: ReturnType<typeof setTimeout> | undefined;
              const unsubscribe = props.isNested
                ? undefined
                : current.subscribeCamera((camera) => {
                    clearTimeout(viewTimer);
                    viewTimer = setTimeout(() => {
                      fireAndForget(
                        saveCanvasViewLocation(documentId, camera),
                        'canvas-persistence'
                      );
                    }, 500);
                  });
              const flush = () => {
                if (canEdit()) finishText();
                if (doc) fireAndForget(session.flush(), 'canvas-session');
              };
              const beforeUnload = (event: BeforeUnloadEvent) => {
                flush();
                if (session.pending() || session.failure()) {
                  event.preventDefault();
                  event.returnValue = '';
                }
              };
              window.addEventListener('pagehide', flush);
              window.addEventListener('beforeunload', beforeUnload);
              onCleanup(() => {
                flush();
                detachDocument();
                unsubscribe?.();
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
  const content = (
    <div class="relative size-full min-h-0">
      <Show when={error()}>
        {(message) => (
          <div
            role="alert"
            class="absolute top-2 left-2 z-50 rounded border border-edge-muted bg-panel p-2 text-sm"
          >
            {message()}{' '}
            <Show
              when={session.state().t === 'error'}
              fallback={
                <button
                  type="button"
                  class="underline"
                  onClick={() =>
                    fireAndForget(session.retrySave(), 'canvas-session')
                  }
                >
                  Retry saving
                </button>
              }
            >
              <button type="button" class="underline" onClick={props.retry}>
                Retry
              </button>
            </Show>
          </div>
        )}
      </Show>
      <Switch>
        <Match when={sharedDoc()} keyed>
          {(doc) => renderEditor(doc)}
        </Match>
        <Match
          when={
            session.state().t === 'unshared' || session.state().t === 'error'
          }
        >
          {renderEditor()}
        </Match>
        <Match when={session.state().t === 'loading'}>
          <Loading />
        </Match>
      </Switch>
    </div>
  );
  return props.children
    ? props.children(content, {
        savedFile: () => {
          revision();
          const current = editor();
          if (!current) return;
          const doc = sharedDoc();
          if (props.shared && !doc) return;
          return new Blob(
            [
              JSON.stringify(
                doc
                  ? readSharedCanvas(doc, documentId)
                  : { ...initial, document: current.document }
              ),
            ],
            { type: 'application/x-macro-canvas' }
          );
        },
        location: currentLocation,
      })
    : content;
}
