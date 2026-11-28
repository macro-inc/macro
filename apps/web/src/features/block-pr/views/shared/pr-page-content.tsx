import { createResizeObserver } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { createEffect, createSignal, type JSX, on } from 'solid-js';
import { createStore } from 'solid-js/store';

/** One background and vertical scroll owner for both PR tabs. */
export function PrPageContent(props: {
  tab: 'overview' | 'changes';
  header: JSX.Element;
  tabs: JSX.Element;
  tabsClass?: string;
  children: JSX.Element;
  scrollerRef: (element: HTMLDivElement) => void;
}) {
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const [tabs, setTabs] = createSignal<HTMLDivElement>();
  const [size, setSize] = createStore({ page: 0, tabs: 0 });
  const positions = { overview: 0, changes: 0 };
  createResizeObserver(scroller, (box) => setSize('page', box.height));
  createResizeObserver(tabs, (_box, element) =>
    setSize('tabs', element.getBoundingClientRect().height)
  );
  // Restore the page DOM, not a second nested scroller, when tabs change.
  createEffect(
    on(
      () => props.tab,
      (tab) => {
        const element = scroller();
        if (element) element.scrollTop = positions[tab];
      }
    )
  );
  return (
    <div
      ref={(element) => {
        setScroller(element);
        props.scrollerRef(element);
      }}
      class="relative isolate min-h-0 flex-1 overflow-y-auto bg-page"
      style={{
        '--pr-page-height': `${size.page}px`,
        '--pr-tabs-height': `${size.tabs}px`,
      }}
      onScroll={(event) => {
        if (event.target === event.currentTarget)
          positions[props.tab] = event.currentTarget.scrollTop;
      }}
    >
      <div class="relative mx-auto w-full @min-[1441px]/pr-page:max-w-[1376px]">
        {props.header}
      </div>
      <div ref={setTabs} class="sticky top-0 z-20 bg-page">
        <div
          class={cn(
            'mx-auto w-full @min-[1441px]/pr-page:max-w-[1376px]',
            props.tabsClass
          )}
        >
          {props.tabs}
        </div>
      </div>
      <div class="relative mx-auto min-h-[calc(var(--pr-page-height)-var(--pr-tabs-height))] w-full @min-[1441px]/pr-page:max-w-[1376px] @min-[1441px]/pr-page:border-x @min-[1441px]/pr-page:border-edge-muted">
        {props.children}
      </div>
    </div>
  );
}
