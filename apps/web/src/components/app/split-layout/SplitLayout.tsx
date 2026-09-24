import {
  createRoutesManifest,
  createSolidRouterLocation,
  decodeRouteLayout,
  SplitRouter,
  type SplitRouterMiddleware,
  type SplitRoutes,
} from '@app/lib/split-router';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { Resize } from '@core/component/Resize';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { tabTitleSignal } from '@core/signal/tabTitle';
import { useLocation, useNavigate } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createSelector,
  For,
  onCleanup,
  type Setter,
  Show,
  Suspense,
} from 'solid-js';
import { PopoverSplitRenderer } from './components/PopoverSplitRenderer';
import { SplitPanel } from './components/SplitPanel';
import { SplitLayoutContext } from './context';
import {
  createSplitLayout,
  type SplitId,
  type SplitManager,
} from './layoutManager';
import {
  createMobileSwipeLayout,
  type MobileSwipeLayout,
} from './mobile/createMobileSwipeLayout';
import { MobileSplitContainer } from './mobile/MobileSplitContainer';
import { splitContentFromLocation } from './split-router/legacy-route';
import { DEFAULT_SPLIT_MIN_WIDTH } from './splitContentSizing';
import { createSplitFocusTracker } from './splitFocusTracker';
import { createAppSplitRouterLayout } from './splitRouterLayout';

type SplitLayoutContainerProps = {
  pairs: string[];
  routes: SplitRoutes;
  middleware?: readonly SplitRouterMiddleware[];
  setManager: Setter<SplitManager | undefined>;
};

export function SplitLayoutContainer(props: SplitLayoutContainerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  // Bootstrap the legacy layout with the same local state adopted by the router.
  const routes = createRoutesManifest(props.routes);
  const initialContents = decodeRouteLayout(routes, props.pairs).map((entry) =>
    splitContentFromLocation(entry.location)
  );
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const splitManager = createSplitLayout(blockOrchestrator, initialContents);
  const routerLayout = createAppSplitRouterLayout(splitManager, routes);
  const externalLocation = createSolidRouterLocation({
    pathname: () => `/${props.pairs.join('/')}`,
    search: () => location.search,
    hash: () => location.hash,
    navigate,
  });
  const [, setTabTitle] = tabTitleSignal;

  // Create the mobile swipe layout once on mobile devices.
  const mobileSwipeLayout: MobileSwipeLayout | undefined =
    isNativeMobilePlatform()
      ? createMobileSwipeLayout(splitManager)
      : undefined;

  // Store a ref to each panel by id
  const panelRefs = new Map<SplitId, HTMLDivElement>();

  const splits = createMemo(splitManager.splits);
  const useBentoLayout = () => !isTouchDevice() && splits().length > 1;

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

  // <For> on plain ids for stable referential equality
  const ids = createMemo(() => splits().map(({ id }) => id));

  createSplitFocusTracker({ splitManager, panelRefs, splits });
  createEffect(() => props.setManager(splitManager));
  onCleanup(() => props.setManager(undefined));

  return (
    <SplitRouter.Root
      layout={routerLayout}
      routes={routes}
      location={externalLocation}
      middleware={props.middleware}
    >
      <SplitLayoutContext.Provider value={{ manager: splitManager }}>
        <div
          class="size-full"
          classList={{ 'py-1.5 pr-1.5': useBentoLayout() }}
        >
          <Show
            when={isNativeMobilePlatform() && mobileSwipeLayout}
            fallback={
              // Desktop: side-by-side resizable splits.
              <Resize.Zone
                direction="horizontal"
                gutter={useBentoLayout() ? 6 : 1}
                showDividers={!useBentoLayout()}
                captureResizeCtx={splitManager.setResizeContext}
              >
                <For each={ids()}>
                  {(id, index) => (
                    <Show when={splitManager.getSplit(id)}>
                      {(handle) => (
                        <Suspense>
                          <Resize.Panel
                            id={id}
                            minSize={DEFAULT_SPLIT_MIN_WIDTH}
                            index={index()}
                          >
                            <SplitPanel
                              split={splits()[index()]!}
                              handle={handle()}
                              active={activeSplitSelector(id)}
                              setPanelRef={(panelRef) =>
                                panelRefs.set(id, panelRef)
                              }
                              index={index()}
                            />
                          </Resize.Panel>
                        </Suspense>
                      )}
                    </Show>
                  )}
                </For>
              </Resize.Zone>
            }
          >
            {/* Mobile: stacked FG/BG layout with swipe-back gesture. */}
            <MobileSplitContainer
              splitManager={splitManager}
              mobileSwipeLayout={mobileSwipeLayout!}
              splits={splits}
              panelRefs={panelRefs}
            />
          </Show>
        </div>
        <PopoverSplitRenderer
          popovers={splitManager.popovers}
          onClosePopover={(id) => {
            const activePopovers = splitManager.getActivePopovers();
            const popover = activePopovers.find((p) => p.id === id);
            popover?.close();
          }}
        />
      </SplitLayoutContext.Provider>
    </SplitRouter.Root>
  );
}
