import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { SoupContextProvider } from '@app/component/next-soup/soup-context';
import { isListViewID, LIST_VIEW_ID } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { isMobile } from '@core/mobile/isMobile';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn, Panel } from '@ui';
import { useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SplitPanelContext, type SplitPanelContextType } from '../context';
import { useSplitLayout } from '../layout';
import type { SplitHandle, SplitState } from '../layoutManager';
import { registerSplitHotkeys } from '../registerSplitHotkeys';
import { createHeaderCollapser } from '../utils/createHeaderCollapser';
import { SplitDrawerGroup } from './SplitDrawerContext';
import { SplitHeader } from './SplitHeader';
import { SplitToolbar } from './SplitToolbar';

export type SplitPanelProps = {
  setPanelRef: (ref: HTMLDivElement) => void;
  handle: SplitHandle;
  split: SplitState;
  active: boolean;
  index: number;
};

export function SplitPanel(props: SplitPanelProps) {
  const [attachHotKeys, splitHotkeyScope] = useHotkeyDOMScope(
    `split=${props.split.id}`
  );
  const [panelRef, setPanelRef] = createSignal<HTMLDivElement | null>(null);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [previewState, setPreviewState] = createSignal(false);
  const panelSize = createElementSize(panelRef);

  const layoutRefs: SplitPanelContextType['layoutRefs'] = {};
  const headerCollapser = createHeaderCollapser(
    () => layoutRefs.headerLeft,
    () => panelSize.width
  );

  const splitLayoutHelpers = useSplitLayout();

  registerSplitHotkeys({
    goHome: () =>
      props.handle.replace({
        next: { type: 'component', id: LIST_VIEW_ID.inbox },
        referredFrom: 'hotkey',
      }),
    isNotUnifiedList: () => {
      const content = props.handle.content();
      return !isListViewID(content.id);
    },
    getSplitCount: () => splitLayoutHelpers.getSplitCount(),
    toggleSpotlight: () => props.handle.toggleSpotlight(),
    canGoForward: () => props.handle.canGoForward(),
    insertSplit: splitLayoutHelpers.insertSplit,
    splitName: () => props.handle.displayName(),
    canGoBack: () => props.handle.canGoBack(),
    goForward: () => props.handle.goForward(),
    closeSplit: () => props.handle.close(),
    goBack: () => props.handle.goBack(),
    splitHotkeyScope,
  });

  const nextSoup = createSoupState({
    initialPredicates: { and: ['explicit-noise'] },
  });

  createEffect(
    on([panelRef], () => {
      if (isMobile()) return;
      panelRef()?.focus();
    })
  );

  const [toolbarRef, setToolbarRef] = createSignal<HTMLDivElement | null>(null);
  const [headerRef, setHeaderRef] = createSignal<HTMLDivElement | null>(null);
  const toolbarSize = createElementSize(toolbarRef);
  const headerSize = createElementSize(headerRef);

  const [hasToolbarContent, setHasToolbarContent] = createSignal(false);
  onMount(() => {
    const checkContent = () => {
      setHasToolbarContent(
        Boolean(
          layoutRefs.toolbarLeft?.hasChildNodes() ||
            layoutRefs.toolbarRight?.hasChildNodes()
        )
      );
    };
    checkContent();
    const observer = new MutationObserver(checkContent);
    if (layoutRefs.toolbarLeft) {
      observer.observe(layoutRefs.toolbarLeft, { childList: true });
    }
    if (layoutRefs.toolbarRight) {
      observer.observe(layoutRefs.toolbarRight, { childList: true });
    }
    onCleanup(() => observer.disconnect());
  });

  const offsetTop = createMemo(() => {
    const offset = (headerSize.height ?? 0) + (toolbarSize.height ?? 0);
    setContentOffsetTop(offset);
    return offset;
  });

  function multipleSplits() {
    const splits = globalSplitManager()?.splits?.();
    return Boolean(splits && splits.length > 1);
  }

  const shouldHideSplitHeader = createMemo(
    () => isMobile() && isListViewID(props.handle.content().id)
  );

  return (
    <SoupContextProvider soup={nextSoup}>
      <SplitPanelContext.Provider
        value={{
          previewState: [previewState, setPreviewState],
          isPanelActive: () => props.active,
          handle: props.handle,
          setContentOffsetTop,
          contentOffsetTop,
          splitHotkeyScope,
          headerCollapser,
          layoutRefs,
          panelSize,
          panelRef,
        }}
      >
        <SplitDrawerGroup contentOffsetTop={offsetTop} panelSize={panelSize}>
          <Show when={props.handle.isSpotLight()}>
            <div
              class="fixed inset-0 w-screen h-screen z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"
              onClick={() => props.handle.toggleSpotlight(false)}
            />
            <div class="fixed inset-16 bg-surface shadow-xl" />
          </Show>

          <div
            classList={{
              'fixed inset-16 z-modal-overlay isolate opacity-50':
                props.handle.isSpotLight(),
              'opacity-100': props.active || props.handle.isSpotLight(),
              'size-full': !props.handle.isSpotLight(),
            }}
            ref={(ref) => {
              setPanelRef(ref);
              props.setPanelRef(ref);
              attachHotKeys(ref);
            }}
            data-split-id={props.split.id}
            data-split-container
            data-modal={props.handle.isSpotLight()}
            tabindex={-1}
          >
            <Panel
              active={
                !isMobile() &&
                props.active &&
                multipleSplits() &&
                !props.handle.isSpotLight()
              }
              class="rounded-xl mobile:rounded-none mobile:after:hidden mobile:!border-0"
              depth={1}
            >
              <Panel.Header
                class={cn(
                  'block min-h-10.25 touch:min-h-11.25 p-0 overflow-visible',
                  shouldHideSplitHeader() && 'hidden'
                )}
              >
                <SplitHeader ref={setHeaderRef} />
              </Panel.Header>

              <Panel.Toolbar
                class={cn(
                  'items-start py-2 overflow-visible',
                  !hasToolbarContent() && 'hidden',
                  !previewState() &&
                    'border-b-0' /* scuffed: this is shit, but we are blinded by linear */
                )}
              >
                <SplitToolbar ref={setToolbarRef} />
              </Panel.Toolbar>

              <Panel.Body>
                <div class="@container/split size-full overflow-hidden relative">
                  <Suspense>
                    <Dynamic component={props.split.mount.element} />
                  </Suspense>
                </div>
              </Panel.Body>
            </Panel>
          </div>
        </SplitDrawerGroup>
      </SplitPanelContext.Provider>
    </SoupContextProvider>
  );
}
