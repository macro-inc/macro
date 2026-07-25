import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import {
  isSidebarVisible,
  useSidebarCollapse,
} from '@components/app/sidebarVisibility';
import { Resize } from '@core/component/Resize';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { tabTitleSignal } from '@core/signal/tabTitle';
import { useWindowSize } from '@solid-primitives/resize-observer';
import { useLocation, useNavigate } from '@solidjs/router';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSelector,
  For,
  on,
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
  SplitEvent,
  type SplitId,
  type SplitManager,
} from './layoutManager';
import { createLayoutUrlSync, restorePreviewPairs } from './layoutUrlSync';
import {
  createMobileSwipeLayout,
  type MobileSwipeLayout,
} from './mobile/createMobileSwipeLayout';
import { MobileSplitContainer } from './mobile/MobileSplitContainer';
import {
  loadRestorablePreviewLayout,
  PREVIEW_QUERY_PARAM,
} from './previewPersistence';
import { createSplitFocusTracker } from './splitFocusTracker';

type SplitLayoutContainerProps = {
  pairs: string[];
  setManager: Setter<SplitManager | undefined>;
};

export function SplitLayoutContainer(props: SplitLayoutContainerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const viewportSize = useWindowSize();
  const previewQuery = () => location.query[PREVIEW_QUERY_PARAM];
  const decodedLayout = createMemo(() =>
    loadRestorablePreviewLayout(props.pairs, previewQuery(), {
      allowPreviewPairs: !isMobile(),
    })
  );
  const initialLayout = decodedLayout();
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const splitManager = createSplitLayout(
    blockOrchestrator,
    initialLayout.contents
  );
  restorePreviewPairs(splitManager, initialLayout.previewPairs);
  const [, setTabTitle] = tabTitleSignal;
  const sidebar = useSidebarCollapse();

  // Create the mobile swipe layout once on mobile devices.
  const mobileSwipeLayout: MobileSwipeLayout | undefined =
    isNativeMobilePlatform()
      ? createMobileSwipeLayout(splitManager)
      : undefined;

  // Store a ref to each panel by id
  const panelRefs = new Map<SplitId, HTMLDivElement>();
  createEffect(
    on(splitManager.events, (event) => {
      if (event.type === SplitEvent.Remove) {
        panelRefs.delete(event.splitId);
      }
    })
  );

  const splits = createMemo(splitManager.splits);

  const activeSplitSelector = createSelector(splitManager.activeSplitId);

  createEffect(() => props.setManager(splitManager));

  onCleanup(() => props.setManager(undefined));

  createEffect(() => {
    setTabTitle(splitManager.tabTitle());
  });

  // <For> on plain ids for stable referential equality
  const ids = createMemo(() => splits().map(({ id }) => id));

  createLayoutUrlSync(
    splitManager,
    () => props.pairs,
    previewQuery,
    decodedLayout,
    {
      navigate,
      search: () => location.search,
      hash: () => location.hash,
    }
  );
  createSplitFocusTracker({ splitManager, panelRefs, splits });

  return (
    <SplitLayoutContext.Provider value={{ manager: splitManager }}>
      <div
        class={cn('size-full p-2 mobile:p-0', {
          'pl-0': isSidebarVisible() && !sidebar.isCollapsed(),
        })}
      >
        <Show
          when={isNativeMobilePlatform() && mobileSwipeLayout}
          fallback={
            // Desktop: side-by-side resizable splits.
            <Resize.Zone
              direction="horizontal"
              gutter={8}
              captureResizeCtx={splitManager.setResizeContext}
            >
              <For each={ids()}>
                {(id, index) => (
                  <Show when={splitManager.getSplit(id)}>
                    {(handle) => (
                      <Suspense>
                        <Resize.Panel
                          id={id}
                          minSize={400}
                          // Automatic redistribution targets an engaged
                          // Controller at its configured preferred width.
                          // This is not a hard max: the gutter can still be
                          // dragged past it.
                          redistributionPreferredSize={splitManager.previewControllerWidth(
                            id,
                            viewportSize.width
                          )}
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
