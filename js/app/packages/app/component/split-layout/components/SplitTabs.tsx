import { playSound } from '@app/util/sound';
import { getIconConfig } from '@core/component/EntityIcon';
import type { ViewId } from '@core/types/view';
import { Tabs } from '@kobalte/core';
import { createElementSize } from '@solid-primitives/resize-observer';
import MagnifyingGlassIcon from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
import WideSignal from '@macro-icons/wide/signal.svg';
import WideNoise from '@macro-icons/wide/noise.svg';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSXElement,
  onMount,
  Show,
  type Setter,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useSplitPanelOrThrow } from '../layoutUtils';

// NOTE: unused since everything should already be correctly cased
const _titleCase = (str: string) => {
  return str
    .split('')
    .map((c, i) => (i === 0 ? c.toUpperCase() : c.toLowerCase()))
    .join('');
};

const SCROLL_THRESHOLD = 10;

const TabSeparator = () => (
  <div class="relative shrink-0 w-3 h-full flex items-center justify-center pointer-events-none">
    <div class="relative w-px h-2/3 bg-gradient-to-b from-transparent via-edge-muted/80 to-transparent" />
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-1 rounded-full bg-edge-muted/60" />
  </div>
);

const VIEW_ICONS: Partial<Record<ViewId, ReturnType<typeof getIconConfig>['icon']>> = {
  signal: WideSignal,
  noise: WideNoise,
  people: getIconConfig('directMessage').icon,
  groups: getIconConfig('channel').icon,
  ai_chats: getIconConfig('chat').icon,
  notes: getIconConfig('md').icon,
  emails: getIconConfig('email').icon,
  files: getIconConfig('write').icon,
  folders: getIconConfig('project').icon,
  all: MagnifyingGlassIcon,
};

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

  // Reorder list to put "all" first
  const reorderedList = createMemo(() => {
    const allTab = props.list.find((tab) => tab.value === 'all');
    const otherTabs = props.list.filter((tab) => tab.value !== 'all');
    return allTab ? [allTab, ...otherTabs] : props.list;
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

        <For each={reorderedList()}>
          {({ value, label }, i) => {
            const isActive = createMemo(() => value === props.active());
            const icon = VIEW_ICONS[value];
            const isAll = value === 'all';
            const isSignalOrNoise = value === 'signal' || value === 'noise';
            const needsSeparator = (() => {
              const prevTab = i() > 0 ? reorderedList()[i() - 1] : null;
              if (prevTab?.value === 'all') return true;
              return prevTab && (prevTab.value === 'signal' || prevTab.value === 'noise') && !isSignalOrNoise;
            })();

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

            const showLabel = () => isSignalOrNoise || isActive() || isAll;

            return (
              <>
                <Show when={needsSeparator}>
                  <TabSeparator />
                </Show>
                <Tabs.Trigger
                  value={value}
                  ref={ref}
                  tabIndex={-1}
                  class="group shrink-0 text-sm relative h-full flex items-center font-mono uppercase"
                  classList={{
                    'min-w-12 max-w-[40cqw] px-2': showLabel() && !isAll,
                    'px-2': !showLabel() || isAll,
                    'z-1 text-accent text-glow': isActive(),
                    'text-ink-disabled hover:text-accent/70 hover-transition-text': !isActive(),
                  }}
                >
                  <span
                    class="flex items-center"
                    classList={{
                      'w-full gap-1.5': showLabel() && !isAll,
                      'justify-start': showLabel() && isAll,
                      'justify-center gap-1.5': !showLabel(),
                    }}
                  >
                    <Show when={icon && !isAll}>
                      <Dynamic
                        component={icon!}
                        class="size-3.5 shrink-0 transition-colors"
                        classList={{
                          'text-accent': isActive(),
                          'text-ink-disabled group-hover:text-accent/70': !isActive(),
                        }}
                      />
                    </Show>
                    <Show when={showLabel()}>
                      <span class="truncate text-xs font-mono uppercase">{label}</span>
                    </Show>
                  </span>
                  {props.contextMenu?.({ label, value })}
                </Tabs.Trigger>
              </>
            );
          }}
        </For>
        {props.newButton}
      </Tabs.List>
    </div>
  );
}
