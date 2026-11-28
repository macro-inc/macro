import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  on,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { prSlimBarVisible } from '../../primitives/pr-page-state';

/** One background and vertical scroll owner for both PR tabs. */
export function PrPageContent(props: {
  tab: 'overview' | 'changes';
  header: JSX.Element;
  decoration?: JSX.Element;
  tabs: (scrolled: Accessor<boolean>) => JSX.Element;
  children: JSX.Element;
  scrollerRef: (element: HTMLDivElement) => void;
}) {
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const [header, setHeader] = createSignal<HTMLDivElement>();
  const [tabs, setTabs] = createSignal<HTMLDivElement>();
  const [size, setSize] = createStore({
    page: 0,
    tabs: 0,
    header: 0,
    scrollTop: 0,
  });
  const positions = { overview: 0, changes: 0 };
  createResizeObserver(scroller, (box) => setSize('page', box.height));
  createResizeObserver(tabs, (_box, element) =>
    setSize('tabs', element.getBoundingClientRect().height)
  );
  createResizeObserver(header, (_box, element) =>
    setSize('header', element.getBoundingClientRect().height)
  );
  const scrolled = () => prSlimBarVisible(size.scrollTop, size.header);
  // Restore the page DOM, not a second nested scroller, when tabs change.
  createEffect(
    on(
      () => props.tab,
      (tab) => {
        const element = scroller();
        if (element) {
          element.scrollTop = positions[tab];
          setSize('scrollTop', element.scrollTop);
        }
      }
    )
  );
  return (
    <div
      ref={(element) => {
        setScroller(element);
        props.scrollerRef(element);
      }}
      class="relative isolate min-h-0 flex-1 overflow-y-auto bg-panel"
      style={{
        '--pr-page-height': `${size.page}px`,
        '--pr-tabs-height': `${size.tabs}px`,
      }}
      onScroll={(event) => {
        if (event.target !== event.currentTarget) return;
        positions[props.tab] = event.currentTarget.scrollTop;
        setSize('scrollTop', event.currentTarget.scrollTop);
      }}
    >
      <div ref={setHeader} class="relative w-full">
        {props.decoration}
        <div class="relative mx-auto w-full @min-[1441px]/pr-page:max-w-[1376px]">
          {props.header}
        </div>
      </div>
      <div ref={setTabs} class="sticky top-0 z-20">
        {props.tabs(scrolled)}
      </div>
      <div class="relative mx-auto min-h-[calc(var(--pr-page-height)-var(--pr-tabs-height))] w-full @min-[1441px]/pr-page:max-w-[1376px] @min-[1441px]/pr-page:border-x @min-[1441px]/pr-page:border-edge-muted">
        {props.children}
      </div>
    </div>
  );
}
