import { playSound } from '@app/util/sound';
import type { ViewId } from '@core/types/view';
import { Tabs } from '@kobalte/core';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSXElement,
  onMount,
  type Setter,
} from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';

// NOTE: unused since everything should already be correctly cased
const _titleCase = (str: string) => {
  return str
    .split('')
    .map((c, i) => (i === 0 ? c.toUpperCase() : c.toLowerCase()))
    .join('');
};

const SCROLL_THRESHOLD = 10;

export function SplitTabs(props: {
  // values: readonly View[];
  list: { value: ViewId; label: string }[];
  active: Accessor<ViewId>;
  setButtonsRef?: Setter<HTMLDivElement | null>;
  newButton?: JSXElement;
  contextMenu?: (props: { value: ViewId; label: string }) => JSXElement;
}) {
  let scrollRef!: HTMLDivElement;
  const panel = useSplitPanelOrThrow();
  const size = createElementSize(panel.panelRef ?? null);
  const panelWidth = () => size.width ?? 0;

  const [leftOpacity, setLeftOpacity] = createSignal(0);
  const [rightOpacity, setRightOpacity] = createSignal(0);

  // Track the active tab's position and width for the sliding indicator
  const [indicatorStyle, setIndicatorStyle] = createSignal({
    left: 0,
    width: 0,
  });

  const updateClipIndicators = () => {
    if (!scrollRef) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef;

    const leftAmount = Math.min(scrollLeft, SCROLL_THRESHOLD);
    setLeftOpacity(leftAmount / SCROLL_THRESHOLD);

    const maxScroll = scrollWidth - clientWidth;
    const remainingScroll = maxScroll - scrollLeft;
    const rightAmount = Math.min(remainingScroll, SCROLL_THRESHOLD);
    setRightOpacity(rightAmount / SCROLL_THRESHOLD);
  };

  const updateIndicatorPosition = (element: HTMLElement) => {
    if (!scrollRef || !element) return;
    const listRect = scrollRef.getBoundingClientRect();
    const tabRect = element.getBoundingClientRect();
    setIndicatorStyle({
      left: tabRect.left - listRect.left + scrollRef.scrollLeft,
      width: tabRect.width,
    });
  };

  onMount(() => {
    const listener = (e: WheelEvent) => {
      e.preventDefault();
      const { deltaX, deltaY } = e;
      const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
      scrollRef.scrollLeft += delta;
      updateClipIndicators();
    };
    const scrollListener = () => {
      updateClipIndicators();
    };
    scrollRef.addEventListener('wheel', listener);
    scrollRef.addEventListener('scroll', scrollListener);
    updateClipIndicators();
    return () => {
      scrollRef.removeEventListener('wheel', listener);
      scrollRef.removeEventListener('scroll', scrollListener);
    };
  });

  createEffect(() => {
    panelWidth();
    updateClipIndicators();
  });

  // Play sound when tab changes
  let previousActive: ViewId | undefined;
  createEffect(() => {
    const currentActive = props.active();
    if (previousActive !== undefined && previousActive !== currentActive) {
      playSound('open');
    }
    previousActive = currentActive;
  });

  return (
    <div class="relative isolate h-full shrink grow-2 @container-normal">
      {/* Left clip boundary indicator */}
      <div
        class="absolute pointer-events-none left-0 top-px bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-r-from-0% border-l border-edge-muted transition-opacity duration-150"
        style={{ opacity: leftOpacity() }}
      />
      {/* Right clip boundary indicator */}
      <div
        class="absolute pointer-events-none right-0 top-px bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-l-from-0% border-r border-edge-muted transition-opacity duration-150"
        style={{ opacity: rightOpacity() }}
      />

      <Tabs.List
        class="flex flex-row suppress-css-brackets h-full bg-panel overflow-x-scroll overscroll-none scrollbar-hidden scroll-shadows-x relative"
        as="div"
        ref={(r) => {
          scrollRef = r;
          props.setButtonsRef?.(r);
        }}
      >
        {/* Sliding indicator line */}
        <div
          class="absolute bottom-0 h-px bg-accent z-10 pointer-events-none transition-all duration-150 ease-out"
          style={{
            transform: `translateX(${indicatorStyle().left}px)`,
            width: `${indicatorStyle().width}px`,
          }}
        />

        <For each={props.list}>
          {({ value, label }, i) => {
            const isActive = createMemo(() => value === props.active());

            let ref: HTMLDivElement | undefined;
            createEffect(() => {
              panelWidth(); // react on width to not clip active tab.
              if (isActive() && ref) {
                ref.scrollIntoView({
                  inline: 'end',
                });
                // Update indicator position and clip indicators
                updateIndicatorPosition(ref);
                setTimeout(updateClipIndicators, 0);
              }
            });

            createEffect(() => {
              if (isActive()) {
                panel.handle.setDisplayName(label);
              }
            });

            return (
              <Tabs.Trigger
                value={value}
                ref={ref}
                tabIndex={-1}
                class="min-w-12 max-w-[40cqw] shrink-0 text-sm relative h-full flex items-center px-2"
                classList={{
                  'z-1 border-y border-edge-muted text-accent text-glow-sm':
                    isActive(),
                  'border-y border-edge-muted text-ink-disabled hover:text-accent/70 hover-transition-text':
                    !isActive(),
                }}
              >
                <span class="flex items-baseline gap-1 w-full">
                  <span class="text-xs font-mono opacity-70 mr-0.5">
                    {(i() + 1).toString()}
                  </span>
                  <span class="truncate">{label}</span>
                </span>
                {/* <Show when={isActive()}>
                  <BrightJoins dots={[true, true, true, true]} />
                </Show> */}
                {props.contextMenu?.({ label, value })}
              </Tabs.Trigger>
            );
          }}
        </For>
        {props.newButton}
      </Tabs.List>
    </div>
  );
}
