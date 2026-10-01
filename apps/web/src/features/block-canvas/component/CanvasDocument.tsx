import { useFeatureFlag } from '@app/lib/analytics/posthog';
import type { PortalScope } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { enableCanvasNext } from '@core/constant/featureFlags';
import { debounce } from '@solid-primitives/scheduled';
import {
  type Accessor,
  createEffect,
  createMemo,
  createRenderEffect,
  createResource,
  createSignal,
  type JSX,
  lazy,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import {
  type CanvasFile,
  canvasVersion,
} from '../canvas-next/core/document-format';
import {
  type CanvasLoadResult,
  loadCanvasFile,
} from '../canvas-next/core/load-document';
import { importCanvasMarkdown } from '../canvas-next/primitives/text-lexical';
import {
  CanvasDocumentProvider,
  type CanvasView,
  useCanvasDocument,
} from '../context/canvas-document-context';
import type { Canvas } from '../model/CanvasModel';
import { fetchCanvasViewLocation } from '../queries/canvas-document';
import {
  useExportCanvasData,
  useLoadCanvasData,
  useSaveCanvasDataImmediate,
} from '../store/canvasData';
import { createNumericParser } from '../util/parse';
import { CanvasController } from './CanvasController';
import { CanvasRenderer } from './CanvasRenderer';
import { Loading } from './Loading';
import { ToolBar } from './ToolBar';

const CanvasNextDocument = lazy(
  () => import('../canvas-next/canvas-next-document')
);

const parseParams = createNumericParser<{
  x?: number;
  y?: number;
  scale?: number;
}>({
  x: ['x', 'canvas_x'],
  y: ['y', 'canvas_y'],
  scale: ['s', 'scale', 'canvas_scale'],
});

type CanvasDataState = 'loading' | 'error' | 'initialized';

export type CanvasDocumentMethods = {
  exportCanvas: () => Promise<Canvas | CanvasFile>;
  goToLocationFromParams: (params: Record<string, unknown>) => void;
};

export type CanvasDocumentProps = {
  documentId: string;
  file?: Blob;
  canEdit: boolean;
  hotkeyScope: string;
  isNested?: boolean;
  portalScope?: PortalScope;
  view?: CanvasView;
  locationParams?: Record<string, string | string[] | undefined>;
  onLocationChange?: (location: CanvasView) => void;
  registerMethods?: (methods: Partial<CanvasDocumentMethods>) => void;
  children?: (content: JSX.Element, state: CanvasDocumentChrome) => JSX.Element;
};

export type CanvasDocumentChrome = {
  mode: 'legacy' | 'next';
  savedFile: Accessor<Blob | undefined>;
  location?: () => { x: number; y: number; s: number };
};

export function CanvasDocument(props: CanvasDocumentProps) {
  return (
    <Show when={props.documentId} keyed>
      {(documentId) => (
        <CanvasDocumentLoader {...props} documentId={documentId} />
      )}
    </Show>
  );
}

function CanvasDocumentLoader(props: CanvasDocumentProps) {
  const flag = useFeatureFlag(enableCanvasNext);
  const [enabled, setEnabled] = createSignal<boolean>();
  // Keep an open document on one editor until it is reopened.
  createEffect(() => {
    if (enabled() === undefined && !flag().loading) setEnabled(flag().enabled);
  });
  const [legacy, setLegacy] = createSignal(false);
  const [loaded] = createResource(
    () =>
      enabled() === undefined
        ? false
        : { file: props.file, enabled: enabled()! },
    async ({ file, enabled }): Promise<CanvasLoadResult> => {
      if (!file)
        return {
          kind: 'error',
          message: 'Canvas file unavailable',
          canOpenLegacy: false,
        };
      try {
        return loadCanvasFile(
          JSON.parse(await file.text()),
          enabled,
          importCanvasMarkdown
        );
      } catch {
        return {
          kind: 'error',
          message: 'Could not read canvas file',
          canOpenLegacy: false,
        };
      }
    }
  );
  createEffect(
    on(
      () => props.file,
      () => setLegacy(false)
    )
  );
  const legacyAllowed = () => {
    const result = loaded();
    return result?.kind === 'error' && result.canOpenLegacy;
  };
  return (
    <Show
      when={enabled() !== undefined && !loaded.loading}
      fallback={<Loading />}
    >
      <Switch>
        <Match
          when={loaded()?.kind === 'legacy' || (legacy() && legacyAllowed())}
        >
          <LegacyCanvasDocument {...props} />
        </Match>
        <Match when={loaded()?.kind === 'next' && loaded()} keyed>
          {(result) =>
            result.kind === 'next' && (
              <CanvasNextDocument {...props} initial={result.file} />
            )
          }
        </Match>
        <Match when={loaded()?.kind === 'error' && loaded()} keyed>
          {(result) =>
            result.kind === 'error' && (
              <div
                role="alert"
                class="flex size-full flex-col items-center justify-center gap-3 p-6 text-sm"
              >
                <p>{result.message}</p>
                <Show when={result.canOpenLegacy}>
                  <button
                    type="button"
                    class="rounded border border-edge-muted px-3 py-2"
                    onClick={() => setLegacy(true)}
                  >
                    Open in legacy editor
                  </button>
                </Show>
              </div>
            )
          }
        </Match>
      </Switch>
    </Show>
  );
}

function LegacyCanvasDocument(props: CanvasDocumentProps) {
  return (
    <Show when={props.documentId} keyed>
      {(documentId) => (
        <CanvasDocumentProvider
          documentId={documentId}
          canEdit={props.canEdit}
          isNested={props.isNested}
          hotkeyScope={props.hotkeyScope}
          portalScope={props.portalScope}
          onLocationChange={props.onLocationChange}
        >
          <CanvasDocumentState {...props} />
        </CanvasDocumentProvider>
      )}
    </Show>
  );
}

function CanvasDocumentState(props: CanvasDocumentProps) {
  const canvas = useCanvasDocument();
  const { isNested, onLocationChange } = canvas;
  const loadCanvasData = useLoadCanvasData();
  const saveCanvasDataImmediate = useSaveCanvasDataImmediate();
  const exportCanvasData = useExportCanvasData();
  const [pending] = canvas.state.signals.pendingUpdates;
  const [renderState, setRenderState] = canvas.state.stores.render;
  const [animation] = canvas.state.stores.animation;
  const [dataState, setDataState] = createSignal<CanvasDataState>('loading');
  const [visible, setVisible] = createSignal(false);
  const [pendingLocationParams, setPendingLocationParams] =
    createSignal<Record<string, unknown>>();

  props.registerMethods?.({
    goToLocationFromParams: setPendingLocationParams,
  });

  createEffect(() => {
    if (dataState() !== 'initialized') return;
    props.registerMethods?.({
      exportCanvas: async () => exportCanvasData(),
    });
  });

  onCleanup(() => {
    if (pending()) void saveCanvasDataImmediate();
  });

  createEffect(() => {
    const handleBeforeUnload = () => {
      if (pending()) void saveCanvasDataImmediate();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    onCleanup(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    });
  });

  createEffect(() => {
    const notifyLocationChange = onLocationChange();
    if (!notifyLocationChange || !visible()) return;

    const notify = debounce(notifyLocationChange, 100);
    let initialized = false;
    createEffect(() => {
      const { x, y, scale } = renderState;
      const state = getCanvasState({ x, y, scale });
      if (!initialized) {
        initialized = true;
        const initialView = props.view;
        if (
          initialView &&
          initialView.x === state.x &&
          initialView.y === state.y &&
          initialView.scale === state.scale
        ) {
          return;
        }
      }
      notify(state);
    });
  });

  const locationSource = createMemo(() => {
    if (props.view) return { type: 'view' as const, view: props.view };
    if (isNested()) return;
    return {
      type: 'document' as const,
      documentId: props.documentId,
      file: props.file,
    };
  });
  const [lastViewLocation] = createResource(locationSource, async (source) => {
    if (source.type === 'view') return source.view;
    return fetchCanvasViewLocation(source.documentId);
  });

  createEffect(() => {
    const file = props.file;
    setDataState('loading');
    setVisible(false);
    if (!file) {
      setDataState('error');
      return;
    }

    let cancelled = false;
    const loadFile = async () => {
      try {
        const data: Canvas = JSON.parse(await file.text());
        if (canvasVersion(data) !== 1)
          throw new Error('This canvas requires Canvas Next');
        const loaded = await loadCanvasData(data, () => !cancelled);
        if (loaded && !cancelled) setDataState('initialized');
      } catch (error) {
        if (cancelled) return;
        setDataState('error');
        toast.failure('Failed to parse canvas file');
        console.error(error);
      }
    };
    void loadFile();
    onCleanup(() => {
      cancelled = true;
    });
  });

  const computedLocation = createMemo(() => {
    if (props.view) return props.view;
    if (isNested()) return null;

    const pendingLocation = parseParams(pendingLocationParams() ?? {});
    if (pendingLocation) return pendingLocation;

    const urlLocation = parseParams(props.locationParams ?? {});
    if (urlLocation) return urlLocation;

    if (lastViewLocation.loading) return;
    return lastViewLocation() ?? null;
  });

  const [centerContentsPending, setCenterContentsPending] = createSignal(false);

  createEffect(
    on([dataState, computedLocation], () => {
      if (dataState() !== 'initialized') return;

      const location = computedLocation();
      if (location) {
        setCanvasState(location);
        setTimeout(() => setVisible(true), 10);
      } else if (location === null) {
        setCenterContentsPending(true);
        setVisible(true);
      }
    })
  );

  createRenderEffect((wasAnimating) => {
    if (visible() || !centerContentsPending()) return;

    const animating = animation.isAnimating;
    if (wasAnimating && !animating) {
      setTimeout(() => setVisible(true), 10);
      setCenterContentsPending(false);
    }
    return animating;
  });

  const setCanvasState = (location: {
    x?: number;
    y?: number;
    scale?: number;
  }) => {
    if (location.scale !== undefined && !Number.isNaN(location.scale)) {
      setRenderState('scale', location.scale / 100);
    }
    if (location.x !== undefined && !Number.isNaN(location.x)) {
      setRenderState('x', location.x);
    }
    if (location.y !== undefined && !Number.isNaN(location.y)) {
      setRenderState('y', location.y);
    }
  };

  const content = (
    <Show
      when={dataState() === 'initialized'}
      fallback={
        <div class="flex size-full items-center justify-center">
          <Loading />
        </div>
      }
    >
      <CanvasController>
        <Show when={visible()}>
          <CanvasRenderer />
          <ToolBar />
        </Show>
      </CanvasController>
    </Show>
  );

  return props.children
    ? props.children(content, {
        mode: 'legacy',
        savedFile: () =>
          canvas.state.signals.currentSavedFile[0]() ?? undefined,
      })
    : content;
}

function getCanvasState(state: {
  x?: number;
  y?: number;
  scale?: number;
}): CanvasView {
  const x = state.x && !Number.isNaN(state.x) ? Math.round(state.x) : 0;
  const y = state.y && !Number.isNaN(state.y) ? Math.round(state.y) : 0;
  const scale =
    state.scale != null && !Number.isNaN(state.scale)
      ? Math.round(state.scale * 100)
      : 100;

  return { x, y, scale };
}
