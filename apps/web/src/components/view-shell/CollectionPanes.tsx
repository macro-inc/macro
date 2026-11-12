import { FloatRegionScope } from '@components/app/mobile/float-regions/FloatRegionScope';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { createMobileSwipeBackGesture } from '@components/app/split-layout/mobile/createMobileSwipeBackGesture';
import { Resize } from '@core/component/Resize';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  createComputed,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  Show,
} from 'solid-js';
import {
  createTouchTopBarInset,
  TouchTopBarFade,
  TouchTopBarInsetProvider,
  touchTopBarInsetStyle,
} from './touch-top-bar';
import { ViewShell } from './ViewShell';
import {
  useViewShellInternal,
  ViewShellListActiveContext,
  ViewShellPaneContext,
  ViewShellReturnToListContext,
} from './view-shell-context';
import {
  DEFAULT_ASIDE_LAYOUT,
  WIDE_TOUCH_ASIDE_SCALE,
} from './view-shell-layout';

/** Stable columns: responsive changes resize/hide frames without remounting editors. */
export function CollectionPanes(props: {
  list: JSX.Element;
  hasDetail: boolean;
  empty?: JSX.Element;
  onListWidthChangeEnd?: (width: number) => void;
  onBack?: () => void | Promise<void>;
  children: JSX.Element;
}) {
  const ws = useViewShellInternal();
  const panel = useSplitPanel();
  const id = createUniqueId();
  const [listWidth, setListWidth] = createSignal(
    DEFAULT_ASIDE_LAYOUT.width * WIDE_TOUCH_ASIDE_SCALE
  );
  const [listFrame, setListFrame] = createSignal<HTMLElement>();
  const [detailFrame, setDetailFrame] = createSignal<HTMLElement>();
  const preferredListWidth = () => ws.main.layout().width ?? listWidth();
  const listVisible = () => ws.collectionLayout() || !props.hasDetail;
  const detailVisible = () => ws.collectionLayout() || props.hasDetail;
  const stacked = () => isTouchDevice() && !listVisible() && !!props.onBack;
  const listMounted = () => listVisible() || stacked();
  const returnToList = () => {
    if (stacked() && panel?.isPanelActive() !== false) return props.onBack;
  };
  const swipe = createMobileSwipeBackGesture({
    canGoBack: () => !!returnToList() && !ws.aside.isOverlay(),
    width: () => ws.width() ?? 0,
    completeGoBack: () => returnToList()?.(),
  });
  const swiping = () =>
    stacked() && (swipe.isDragging() || swipe.isAnimatingOut());
  const topBarInset = createTouchTopBarInset();
  createComputed(
    on(stacked, (active) => {
      if (!active) swipe.reset();
    })
  );
  return (
    <ViewShell.Main class="relative overflow-hidden">
      <Resize.Zone
        direction="horizontal"
        gutter={1}
        resizable={ws.collectionLayout()}
        showTouchDividers={ws.collectionLayout()}
      >
        <Resize.Panel
          id={`${id}-list`}
          index={0}
          minSize={320}
          maxSize={
            ws.collectionLayout() ? (ws.main.layout().max ?? 720) : undefined
          }
          redistributionPreferredSize={
            ws.collectionLayout() ? preferredListWidth() : undefined
          }
          onSizeChangeEnd={props.onListWidthChangeEnd ?? setListWidth}
          collapsed={() => !listMounted()}
          target={
            ws.collectionLayout()
              ? {
                  kind: 'px',
                  px: preferredListWidth(),
                }
              : undefined
          }
        >
          <ViewShellPaneContext.Provider value="main">
            <FloatRegionScope anchor={listFrame} active={listVisible}>
              <div
                ref={setListFrame}
                class="relative flex size-full min-h-0 min-w-0 flex-col"
                classList={{
                  isolate: stacked(),
                  invisible: !listVisible() && !swiping(),
                }}
                style={swiping() ? swipe.styleForSlot(false) : undefined}
                data-view-shell-list
                inert={!listVisible()}
                aria-hidden={!listVisible()}
              >
                <Show when={listMounted()}>
                  <ViewShellListActiveContext.Provider value={listVisible}>
                    {props.list}
                  </ViewShellListActiveContext.Provider>
                </Show>
              </div>
            </FloatRegionScope>
          </ViewShellPaneContext.Provider>
        </Resize.Panel>
        <Resize.Panel
          id={`${id}-detail`}
          index={1}
          minSize={320}
          overlay={stacked()}
          collapsed={() => !detailVisible()}
        >
          <ViewShellPaneContext.Provider value="detail">
            <FloatRegionScope anchor={detailFrame} active={detailVisible}>
              <div
                ref={setDetailFrame}
                class="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
                classList={{ 'bg-panel': stacked() }}
                style={{
                  ...touchTopBarInsetStyle(topBarInset.height(), '0px'),
                  ...(swiping() ? swipe.styleForSlot(true) : undefined),
                }}
                data-view-shell-detail
                on:touchstart={(event) => {
                  // A narrow detail returns within its own workspace. Do not
                  // also start the enclosing split's back gesture.
                  if (swipe.handleTouchStart(event)) event.stopPropagation();
                }}
                on:touchmove={swipe.handleTouchMove}
                on:touchend={swipe.handleTouchEnd}
                on:touchcancel={swipe.handleTouchCancel}
                inert={!detailVisible()}
                aria-hidden={!detailVisible()}
              >
                <TouchTopBarInsetProvider value={topBarInset.value}>
                  <Show
                    when={props.hasDetail}
                    fallback={props.empty ?? <CollectionEmpty />}
                  >
                    <ViewShellReturnToListContext.Provider value={returnToList}>
                      {props.children}
                    </ViewShellReturnToListContext.Provider>
                  </Show>
                </TouchTopBarInsetProvider>
                <TouchTopBarFade height={topBarInset.height()} />
              </div>
            </FloatRegionScope>
          </ViewShellPaneContext.Provider>
        </Resize.Panel>
      </Resize.Zone>
    </ViewShell.Main>
  );
}

export function CollectionEmpty() {
  return (
    <div class="flex size-full min-h-0 items-center justify-center px-6 text-center text-sm text-ink-muted">
      Select an item to preview
    </div>
  );
}
