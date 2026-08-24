import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { Resize } from '@core/component/Resize';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { tabTitleSignal } from '@core/signal/tabTitle';
import { useWindowSize } from '@solid-primitives/resize-observer';
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
import {
  isSideSplit,
  releaseSideSplit,
  SIDE_SPLIT_MIN_WIDTH,
  sideSplitPreferredWidth,
} from './side-split-sizing';
import { splitMinWidthForContent } from './splitContentSizing';
import { createSplitFocusTracker } from './splitFocusTracker';

/** The hairline between two splits, and the whole of the gap between them. */
const SPLIT_SEAM_WIDTH = 1;

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
      allowPreviewPairs: !isTouchDevice(),
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

  // Create the mobile swipe layout once on mobile devices.
  const mobileSwipeLayout: MobileSwipeLayout | undefined =
    isNativeMobilePlatform()
      ? createMobileSwipeLayout(splitManager)
      : undefined;

  // Store a ref to each panel by id
  const panelRefs = new Map<SplitId, HTMLDivElement>();

  const splits = createMemo(splitManager.splits);

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
      {/* No inset: the splits fill the frame and a hairline gutter is the only
          thing between them. */}
      <div class="size-full">
        <Show
          when={isNativeMobilePlatform() && mobileSwipeLayout}
          fallback={
            // Desktop: side-by-side resizable splits.
            <Resize.Zone
              direction="horizontal"
              gutter={SPLIT_SEAM_WIDTH}
              seam
              captureResizeCtx={splitManager.setResizeContext}
            >
              <For each={ids()}>
                {(id, index) => {
                  // A side split's narrow sizing is keyed by split id, so it
                  // has to be released when the split leaves the layout.
                  onCleanup(() => releaseSideSplit(id));

                  return (
                    <Show when={splitManager.getSplit(id)}>
                      {(handle) => (
                        <Suspense>
                          <Resize.Panel
                            id={id}
                            minSize={
                              isSideSplit(id)
                                ? SIDE_SPLIT_MIN_WIDTH
                                : splitMinWidthForContent(handle().content(), {
                                    isPreviewController:
                                      handle().isControllerSplit(),
                                  })
                            }
                            // A Preview Pair is one layout unit: its two splits
                            // share the space a single split would get. Both
                            // members key their group by the Controller's id.
                            shareGroup={
                              splitManager.viewerOf(id) !== undefined
                                ? id
                                : splitManager.controllerOf(id)
                            }
                            // Automatic redistribution targets an engaged
                            // Controller at its configured preferred width.
                            // This is not a hard max: the gutter can still be
                            // dragged past it.
                            redistributionPreferredSize={
                              isSideSplit(id)
                                ? sideSplitPreferredWidth(
                                    viewportSize.width ?? 0
                                  )
                                : splitManager.previewControllerWidth(
                                    id,
                                    viewportSize.width
                                  )
                            }
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
                  );
                }}
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
