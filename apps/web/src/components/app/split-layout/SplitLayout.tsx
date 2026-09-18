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
import { createLayoutUrlSync } from './layoutUrlSync';
import { decodePairs } from './layoutUtils';
import {
  createMobileSwipeLayout,
  type MobileSwipeLayout,
} from './mobile/createMobileSwipeLayout';
import { MobileSplitContainer } from './mobile/MobileSplitContainer';
import { DEFAULT_SPLIT_MIN_WIDTH } from './splitContentSizing';
import { createSplitFocusTracker } from './splitFocusTracker';

type SplitLayoutContainerProps = {
  pairs: string[];
  setManager: Setter<SplitManager | undefined>;
};

export function SplitLayoutContainer(props: SplitLayoutContainerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const initialContents = decodePairs(props.pairs);
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const splitManager = createSplitLayout(blockOrchestrator, initialContents);
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
  // multiple splits), and the events signal only surfaces the last event.
  createEffect(() => {
    const alive = new Set(splits().map(({ id }) => id));
    for (const id of panelRefs.keys()) {
      if (!alive.has(id)) panelRefs.delete(id);
    }
  });

  const activeSplitSelector = createSelector(splitManager.activeSplitId);

  createEffect(() => props.setManager(splitManager));

  onCleanup(() => props.setManager(undefined));

  createEffect(() => {
    setTabTitle(splitManager.tabTitle());
  });

  // <For> on plain ids for stable referential equality
  const ids = createMemo(() => splits().map(({ id }) => id));

  createLayoutUrlSync(splitManager, () => props.pairs, {
    navigate,
    search: () => location.search,
  });
  createSplitFocusTracker({ splitManager, panelRefs, splits });

  return (
    <SplitLayoutContext.Provider value={{ manager: splitManager }}>
      <div class="size-full" classList={{ 'py-1.5 pr-1.5': useBentoLayout() }}>
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
  );
}
