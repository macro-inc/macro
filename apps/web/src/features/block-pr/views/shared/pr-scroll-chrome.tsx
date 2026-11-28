import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { scrollChromeCompensation } from '../../primitives/create-scroll-hide-reveal';

/** Chrome and its inverse spacer share one CSS timeline to preserve the scroll range. */
export function PrChromeRow(props: {
  shown: boolean;
  children: JSX.Element;
  class?: string;
  animate?: boolean;
}) {
  return (
    <div
      class={cn(
        'relative grid shrink-0 motion-reduce:transition-none',
        props.animate === false
          ? 'transition-none'
          : 'transition-[grid-template-rows,opacity] duration-200 ease-out',
        props.shown
          ? 'grid-rows-[1fr] opacity-100'
          : 'grid-rows-[0fr] opacity-0',
        props.class
      )}
      inert={!props.shown}
      aria-hidden={!props.shown}
    >
      <div class="min-h-0 overflow-hidden">{props.children}</div>
    </div>
  );
}

export function PrChromeSpace(props: {
  expandedHeight: number;
  compactHeight?: number;
  topBarHeight?: number;
  scrolled: boolean;
  topBarVisible?: boolean;
  animate?: boolean;
}) {
  return (
    <div aria-hidden="true" class="pointer-events-none flex shrink-0 flex-col">
      <PrChromeRow shown={props.scrolled} animate={props.animate}>
        <div
          style={{
            height: `${scrollChromeCompensation(props.expandedHeight, props.compactHeight ?? 0, 0, 0, true)}px`,
          }}
        />
      </PrChromeRow>
      <PrChromeRow
        shown={props.topBarVisible === false}
        animate={props.animate}
      >
        <div style={{ height: `${props.topBarHeight ?? 0}px` }} />
      </PrChromeRow>
    </div>
  );
}
