import { FloatRegionScope } from '@components/app/mobile/float-regions/FloatRegionScope';
import { Resize } from '@core/component/Resize';
import { createSignal, createUniqueId, type JSX, Show } from 'solid-js';
import { ViewShell } from './ViewShell';
import {
  useViewShellInternal,
  ViewShellPaneContext,
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
  children: JSX.Element;
}) {
  const ws = useViewShellInternal();
  const id = createUniqueId();
  const [listWidth, setListWidth] = createSignal(
    DEFAULT_ASIDE_LAYOUT.width * WIDE_TOUCH_ASIDE_SCALE
  );
  const [listFrame, setListFrame] = createSignal<HTMLElement>();
  const [detailFrame, setDetailFrame] = createSignal<HTMLElement>();
  const listVisible = () => ws.collectionLayout() || !props.hasDetail;
  const detailVisible = () => ws.collectionLayout() || props.hasDetail;
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
          maxSize={ws.collectionLayout() ? 720 : undefined}
          redistributionPreferredSize={
            ws.collectionLayout() ? listWidth() : undefined
          }
          onSizeChangeEnd={setListWidth}
          collapsed={() => !listVisible()}
          target={
            ws.collectionLayout()
              ? {
                  kind: 'px',
                  px: listWidth(),
                }
              : undefined
          }
        >
          <ViewShellPaneContext.Provider value="main">
            <FloatRegionScope anchor={listFrame} active={listVisible}>
              <div
                ref={setListFrame}
                class="relative flex size-full min-h-0 min-w-0 flex-col"
                data-view-shell-list
                inert={!listVisible()}
                aria-hidden={!listVisible()}
              >
                <Show when={listVisible()}>{props.list}</Show>
              </div>
            </FloatRegionScope>
          </ViewShellPaneContext.Provider>
        </Resize.Panel>
        <Resize.Panel
          id={`${id}-detail`}
          index={1}
          minSize={320}
          collapsed={() => !detailVisible()}
        >
          <ViewShellPaneContext.Provider value="detail">
            <FloatRegionScope anchor={detailFrame} active={detailVisible}>
              <div
                ref={setDetailFrame}
                class="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden touch:[--mobile-content-inset-top:0px]"
                data-view-shell-detail
                inert={!detailVisible()}
                aria-hidden={!detailVisible()}
              >
                <Show
                  when={props.hasDetail}
                  fallback={props.empty ?? <CollectionEmpty />}
                >
                  {props.children}
                </Show>
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
