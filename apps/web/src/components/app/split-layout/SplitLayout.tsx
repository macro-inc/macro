import { CreateContextProvider } from '@app/features/command/context/create-context';
import { useSplitRouter } from '@app/lib/split-router';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { globalTabManager } from '@app/signal/tabLayout';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { DesktopTabsController } from '@components/app/tab-layout/DesktopTabsController';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { tabTitleSignal } from '@core/signal/tabTitle';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { PopoverSplitRenderer } from './components/PopoverSplitRenderer';
import { SplitPanel } from './components/SplitPanel';
import { SplitLayoutContext } from './context';
import { INITIAL_LAYER_ID, type SplitLayers, sameIds } from './layers';
import {
  createSplitLayout,
  paneOf,
  type SplitId,
  splitOf,
} from './layoutManager';
import { createMobilePaneStack } from './mobile/createMobilePaneStack';
import { MobileSplitContainer } from './mobile/MobileSplitContainer';
import {
  consumeSplitBelowIntent,
  installSplitBelowIntentTracker,
} from './split-below-intent';
import type { TileArea } from './split-geometry';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from './split-router/legacy-route';
import { createSplitFocusTracker } from './splitFocusTracker';
import { TiledSplits } from './TiledSplits';

/** Own the layout and creation context above both app chrome and pane content. */
export function SplitLayoutProvider(props: ParentProps) {
  const router = useSplitRouter();
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const userId = useUserId();
  const authenticated = useIsAuthenticated();

  const splitManager = createSplitLayout(blockOrchestrator, {
    router,
    toLocation: (content) => resolveContentLocation(router.routes, content),
    toContent: splitContentFromLocation,
    stacked: isNativeMobilePlatform,
    sessionKey: () => (authenticated() === false ? undefined : userId()),
    consumeSplitBelowIntent,
  });
  if (!isTouchDevice()) onCleanup(installSplitBelowIntentTracker());
  createEffect(() => setGlobalSplitManager(splitManager));
  onCleanup(() => setGlobalSplitManager(undefined));

  return (
    <SplitLayoutContext.Provider value={{ manager: splitManager }}>
      <CreateContextProvider focusedPaneId={splitManager.activeSplitId}>
        <DesktopTabsController router={router} manager={splitManager} />
        {props.children}
      </CreateContextProvider>
    </SplitLayoutContext.Provider>
  );
}

/** The app route's view: one panel per pane in the owning layout. */
export function SplitLayout() {
  const router = useSplitRouter();
  const layout = useContext(SplitLayoutContext);
  if (!layout) throw new Error('SplitLayout requires SplitLayoutProvider');
  const splitManager = layout.manager;
  const paneStack = isNativeMobilePlatform()
    ? createMobilePaneStack(splitManager)
    : undefined;
  const [, setTabTitle] = tabTitleSignal;

  // Store a ref to each panel by id
  const panelRefs = new Map<SplitId, HTMLDivElement>();

  const splits = createMemo(splitManager.splits);
  const useBentoLayout = () => !isTouchDevice();

  // <For> on plain ids for stable referential equality
  const ids = createMemo(() => splits().map(({ id }) => id));

  // Desktop tabs render one layer per tab; without them, one live layer.
  const layers = (): SplitLayers => {
    const tabLayers = globalTabManager();
    if (tabLayers) return tabLayers;

    return {
      layerIds: () => [INITIAL_LAYER_ID],
      layerSplits: ids,
      isLive: () => true,
    };
  };
  const layerIds = createMemo(() => layers().layerIds(), undefined, {
    equals: sameIds,
  });

  // Drop refs for departed splits by reconciling against the live list:
  // batched mutations can remove several splits in one flush (e.g. closing
  // a Preview Pair), and the events signal only surfaces the last event.
  // Parked splits stay mounted, so they keep their refs.
  createEffect(() => {
    splits();
    for (const id of panelRefs.keys()) {
      if (!splitManager.splitState(id)) panelRefs.delete(id);
    }
  });

  const activeSplitSelector = createSelector(splitManager.activeSplitId);

  createEffect(() => {
    setTabTitle(splitManager.tabTitle());
  });

  createSplitFocusTracker({ splitManager, panelRefs, splits });

  function SplitLayer(props: { layer: string }) {
    const live = () => layers().isLive(props.layer);
    const layerPanes = createMemo(
      () => layers().layerSplits(props.layer).map(paneOf),
      [],
      { equals: sameIds }
    );
    // The live layer tiles as the open panes do; a parked one as its panes
    // did when they were parked.
    const tiles = () => {
      const [first] = layerPanes();

      return first && router.layoutOf(first);
    };
    const [area, setArea] = createSignal<TileArea>();
    createEffect(() => {
      const measured = area();
      if (live() && measured) splitManager.setTileArea(measured);
    });

    return (
      // A parked layer keeps its views mounted but skips their rendering,
      // and inert keeps focus, hotkeys, and assistive tech out of it.
      <div
        class="absolute inset-0"
        classList={{ 'invisible [content-visibility:hidden]': !live() }}
        inert={!live()}
        data-split-layer={props.layer}
      >
        <TiledSplits
          layout={tiles}
          panes={layerPanes}
          gutter={useBentoLayout() ? 6 : 1}
          showDividers={!useBentoLayout()}
          onResize={(path, shares) => {
            if (live()) router.resizeLayout(path, shares);
          }}
          onArea={setArea}
        >
          {(pane, index) => {
            const id = splitOf(pane);

            return (
              <Show when={splitManager.getSplit(id)}>
                {(handle) => (
                  <Show when={splitManager.splitState(id)}>
                    {(split) => (
                      <Suspense>
                        <SplitPanel
                          split={split()}
                          handle={handle()}
                          active={activeSplitSelector(id)}
                          setPanelRef={(panelRef) =>
                            panelRefs.set(id, panelRef)
                          }
                          index={index()}
                        />
                      </Suspense>
                    )}
                  </Show>
                )}
              </Show>
            );
          }}
        </TiledSplits>
      </div>
    );
  }

  return (
    <>
      <Show
        when={paneStack}
        fallback={
          <div
            class="size-full"
            classList={{ 'py-1.5 pr-1.5': useBentoLayout() }}
          >
            <div class="relative size-full">
              <For each={layerIds()}>
                {(layer) => <SplitLayer layer={layer} />}
              </For>
            </div>
          </div>
        }
      >
        {(stack) => (
          <MobileSplitContainer
            splitManager={splitManager}
            stack={stack()}
            splits={splits}
            panelRefs={panelRefs}
          />
        )}
      </Show>
      <PopoverSplitRenderer
        popovers={splitManager.popovers}
        onClosePopover={(id) => {
          const activePopovers = splitManager.getActivePopovers();
          const popover = activePopovers.find((p) => p.id === id);
          popover?.close();
        }}
      />
    </>
  );
}
