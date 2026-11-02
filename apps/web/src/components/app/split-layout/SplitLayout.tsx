import { CreateContextProvider } from '@app/features/command/context/create-context';
import { useSplitRouter } from '@app/lib/split-router';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
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
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { PopoverSplitRenderer } from './components/PopoverSplitRenderer';
import { SplitPanel } from './components/SplitPanel';
import { SplitLayoutContext } from './context';
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

  // Drop refs for departed splits by reconciling against the live list:
  // batched mutations can remove several splits in one flush (e.g. closing
  // a Preview Pair), and the events signal only surfaces the last event.
  createEffect(() => {
    const alive = new Set(splits().map(({ id }) => id));
    for (const id of panelRefs.keys()) {
      if (!alive.has(id)) panelRefs.delete(id);
    }
  });

  const activeSplitSelector = createSelector(splitManager.activeSplitId);

  createEffect(() => {
    setTabTitle(splitManager.tabTitle());
  });

  // Plain ids for stable referential equality
  const paneIds = createMemo(() => splits().map(({ id }) => paneOf(id)));

  createSplitFocusTracker({ splitManager, panelRefs, splits });

  return (
    <>
      <Show
        when={paneStack}
        fallback={
          <div
            class="size-full"
            classList={{ 'py-1.5 pr-1.5': useBentoLayout() }}
          >
            <TiledSplits
              layout={router.layout}
              panes={paneIds}
              gutter={useBentoLayout() ? 6 : 1}
              showDividers={!useBentoLayout()}
              onResize={router.resizeLayout}
              onArea={splitManager.setTileArea}
            >
              {(pane, index) => {
                const id = splitOf(pane);

                return (
                  <Show when={splitManager.getSplit(id)}>
                    {(handle) => (
                      <Suspense>
                        <SplitPanel
                          split={splits()[index()]!}
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
                );
              }}
            </TiledSplits>
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
