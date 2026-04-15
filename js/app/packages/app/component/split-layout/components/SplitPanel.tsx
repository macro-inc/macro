import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { SoupContextProvider } from '@app/component/next-soup/soup-context';
import { createElementSize } from '@solid-primitives/resize-observer';
import { useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { createSignal, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SplitContainer } from './SplitContainer';
import { SplitPanelContext, type SplitPanelContextType } from '../context';
import { useSplitLayout } from '../layout';
import type { SplitHandle, SplitState } from '../layoutManager';
import { createHeaderCollapser } from '../utils/createHeaderCollapser';
import { registerSplitHotkeys } from '../registerSplitHotkeys';
import { isListViewID } from '@app/constants/list-views';
import { isMobile } from '@core/mobile/isMobile';

export type SplitPanelProps = {
  split: SplitState;
  handle: SplitHandle;
  active: boolean;
  setPanelRef: (ref: HTMLDivElement) => void;
  index: number;
};

export function SplitPanel(props: SplitPanelProps) {
  const [panelRef, setPanelRef] = createSignal<HTMLDivElement | null>(null);
  const [attachHotKeys, splitHotkeyScope] = useHotkeyDOMScope(
    `split=${props.split.id}`
  );

  const panelSize = createElementSize(panelRef);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);

  const [previewState, setPreviewState] = createSignal(false);

  const layoutRefs: SplitPanelContextType['layoutRefs'] = {};
  const headerCollapser = createHeaderCollapser(
    () => layoutRefs.headerLeft,
    () => panelSize.width
  );

  const splitLayoutHelpers = useSplitLayout();
  registerSplitHotkeys({
    splitHotkeyScope,
    insertSplit: splitLayoutHelpers.insertSplit,
    closeSplit: () => props.handle.close(),
    toggleSpotlight: () => props.handle.toggleSpotlight(),
    canGoBack: () => props.handle.canGoBack(),
    goBack: () => props.handle.goBack(),
    canGoForward: () => props.handle.canGoForward(),
    goForward: () => props.handle.goForward(),
    replaceSplit: splitLayoutHelpers.replaceSplit,
    splitName: () => props.handle.displayName(),
    getSplitCount: () => splitLayoutHelpers.getSplitCount(),
    isNotUnifiedList: () => {
      const content = props.handle.content();
      return !isListViewID(content.id);
    },
  });

  const nextSoup = createSoupState({
    initialFilters: ['explicit-noise'],
  });

  return (
    <SoupContextProvider soup={nextSoup}>
      <SplitPanelContext.Provider
        value={{
          handle: props.handle,
          splitHotkeyScope,
          isPanelActive: () => props.active,
          panelRef,
          panelSize,
          layoutRefs,
          contentOffsetTop,
          setContentOffsetTop,
          previewState: [previewState, setPreviewState],
          headerCollapser,
        }}
      >
        <SplitContainer
          id={props.split.id}
          ref={(ref) => {
            setPanelRef(ref);
            props.setPanelRef(ref);
            attachHotKeys(ref);
          }}
          tl={props.index === 0 && !isMobile()}
          bl={props.index === 0 && !isMobile()}
          tr={
            splitLayoutHelpers.getSplitCount() > 1 &&
            props.index === splitLayoutHelpers.getSplitCount() - 1 &&
            !isMobile()
          }
          br={
            splitLayoutHelpers.getSplitCount() > 1 &&
            props.index === splitLayoutHelpers.getSplitCount() - 1 &&
            !isMobile()
          }
        >
          <Suspense>
            <Dynamic component={props.split.mount.element} />
          </Suspense>
        </SplitContainer>
      </SplitPanelContext.Provider>
    </SoupContextProvider>
  );
}
