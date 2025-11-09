import { createNumericParser } from '@block-canvas/util/parse';
import { withAnalytics } from '@coparse/analytics';
import {
  useBlockId,
  useBlockNestedContext,
  useIsNestedBlock,
} from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { blockFileSignal, blockHandleSignal } from '@core/signal/load';
import { isErr } from '@core/util/maybeResult';
import type { IDocumentStorageServiceFile } from '@filesystem/file';
import { storageServiceClient } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { useSearchParams } from '@solidjs/router';
import { toast } from 'core/component/Toast/Toast';
import { createMethodRegistration } from 'core/orchestrator';
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createResource,
  createSignal,
  on,
  Show,
} from 'solid-js';
import { blockDataSignal } from '../signal/canvasBlockData';
import { useLoadCanvasData } from '../store/canvasData';
import { isAnimating, renderStateStore } from '../store/RenderState';
import { CanvasController } from './CanvasController';
import { CanvasRenderer } from './CanvasRenderer';
import { Loading } from './Loading';
import { LoadingMindMap } from './LoadingMindMap';
import { ToolBar } from './ToolBar';
import { TopBar } from './TopBar';

const { track, TrackingEvents } = withAnalytics();

const LoadingView = () => (
  <div class="w-full h-full flex items-center justify-center">
    <Loading />
  </div>
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

const numberOrUndefined = (
  n: string | undefined | null
): number | undefined => {
  const num = Number(n);
  return n == null || Number.isNaN(num) ? undefined : num;
};

type BlockDataState = 'loading' | 'error' | 'blockdata' | 'initialized';

export type BlockCanvasProps = {
  view?: {
    x: number;
    y: number;
    scale: number;
  };
};

export default function BlockCanvas(props: BlockCanvasProps) {
  const documentId = useBlockId();
  const isNestedBlock = useIsNestedBlock();
  const nestedContext = useBlockNestedContext<'canvas'>();
  const loadCanvasData = useLoadCanvasData();
  const [, setRenderState] = renderStateStore;
  const [dataState, setDataState] = createSignal<BlockDataState>('loading');
  const [visible, setVisible] = createSignal(false);

  createEffect(() => {
    const context = nestedContext?.parentContext;
    if (!context) return;
    const onLocationChange = context.canvas?.onLocationChange;
    if (!onLocationChange) return;
    const debouncedFn = debounce(onLocationChange, 100);
    if (!visible()) return;

    let initialized = false;
    createEffect(() => {
      const store = renderStateStore.get;
      let { x, y, scale } = store;
      const state = getCanvasState({ x, y, scale });
      // prevent the location from being set on the initial render if the view is the same as the initial view
      if (!initialized) {
        initialized = true;
        const initView = props.view;
        if (
          initView &&
          initView.x === state.x &&
          initView.y === state.y &&
          initView.scale === state.scale
        ) {
          return;
        }
      }
      debouncedFn(state);
    });
  });

  const blockDataLocationSource = createMemo(() => {
    if (props.view) return { sourceType: 'view' as const, data: props.view };

    if (isNestedBlock) return undefined;
    return { sourceType: 'blockData' as const, data: blockDataSignal() };
  });
  const [lastViewLocation, { refetch }] = createResource(
    blockDataLocationSource,
    async (source) => {
      if (source.sourceType === 'view') {
        return source.data;
      }

      const res = await storageServiceClient.getDocumentMetadata({
        documentId,
        init: {
          signal: AbortSignal.timeout(3000),
        },
      });

      if (isErr(res)) return null;
      const [, { viewLocation }] = res;

      if (!viewLocation) return null;
      const initialParams = new URLSearchParams(viewLocation.replace('#', ''));
      const x = numberOrUndefined(initialParams.get('x'));
      const y = numberOrUndefined(initialParams.get('y'));
      const scale = numberOrUndefined(initialParams.get('s'));
      return { x, y, scale };
    }
  );

  createEffect(() => {
    const file = blockFileSignal();
    refetch();
    setDataState('blockdata');
    if (!file) {
      setDataState('error');
      return;
    }
    parseCanvasFile(file);
    track(TrackingEvents.BLOCKCANVAS.OPEN);
  });

  const [urlSearchParams] = useSearchParams();
  const [pendingLocationParams, setPendingLocationParams] =
    createSignal<Record<string, any>>();
  const blockHandle = blockHandleSignal.get;

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (params: Record<string, any>) => {
      setPendingLocationParams(params);
    },
  });

  // null = no location, undefined = pending location, object = some location
  const computedLocation = createMemo(() => {
    if (props.view) return props.view;
    if (isNestedBlock) return null;

    const pendingLocation = parseParams(pendingLocationParams() || {});
    if (pendingLocation) return pendingLocation;

    const urlLocation = parseParams({ ...urlSearchParams });
    if (urlLocation) return urlLocation;

    const serverLocation = lastViewLocation();
    if (lastViewLocation.loading) {
      return undefined;
    }
    if (serverLocation) return serverLocation;

    return null;
  });

  const [centerContentsPending, setCenterContentsPending] = createSignal(false);

  createEffect(
    on([dataState, computedLocation], () => {
      if (dataState() === 'initialized') {
        const location = computedLocation();
        if (location) {
          setCanvasState(location);
          setTimeout(() => {
            setVisible(true);
          }, 10);
        } else if (location === null) {
          setCenterContentsPending(true);
          setVisible(true);
        } else {
        }
      }
    })
  );

  createRenderEffect((prev) => {
    if (visible() || !centerContentsPending()) return;
    const animating = isAnimating();
    if (prev && !animating) {
      setTimeout(() => {
        setVisible(true);
      }, 10);
      setCenterContentsPending(false);
    }
    return animating;
  });

  const getCanvasState = (state: {
    x?: number;
    y?: number;
    scale?: number;
  }) => {
    const x = state.x && !isNaN(state.x) ? Math.round(state.x) : 0;
    const y = state.y && !isNaN(state.y) ? Math.round(state.y) : 0;
    const scale =
      state.scale != null && !isNaN(state.scale)
        ? Math.round(state.scale * 100)
        : 100;

    return { x, y, scale };
  };

  const setCanvasState = createCallback(
    (location: { x?: number; y?: number; scale?: number }) => {
      if (location.scale !== undefined && !isNaN(location.scale)) {
        setRenderState('scale', location.scale / 100);
      }
      if (location.x !== undefined && !isNaN(location.x)) {
        setRenderState('x', location.x);
      }
      if (location.y !== undefined && !isNaN(location.y)) {
        setRenderState('y', location.y);
      }
    }
  );

  async function parseCanvasFile(file: IDocumentStorageServiceFile) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await loadCanvasData(json);
      setDataState('initialized');
    } catch (e) {
      setDataState('error');
      toast.failure('Failed to parse canvas file');
      console.error(e);
    }
    return file;
  }

  return (
    <DocumentBlockContainer>
      <div
        class="w-full h-full select-none flex flex-col bg-panel"
        // TODO: we need a more robust solution for preventing parent blocks from stealing clicks
        // This is a temporary fix for canvas in markdown but it doesn't necessarily generalize well
        on:click={(e) => {
          if (isNestedBlock) {
            e.stopPropagation();
          }
        }}
      >
        <Show when={!isNestedBlock}>
          <TopBar />
        </Show>
        <Show when={dataState() === 'initialized'} fallback={<LoadingView />}>
          <CanvasController>
            <Show when={visible()}>
              <CanvasRenderer />
              <ToolBar />
            </Show>
          </CanvasController>
        </Show>
        <LoadingMindMap />
      </div>
    </DocumentBlockContainer>
  );
}
