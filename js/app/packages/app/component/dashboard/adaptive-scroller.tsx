import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { Button, cn } from '@ui';
import {
  createContext,
  createSignal,
  Show,
  type JSX,
  onCleanup,
  onMount,
  splitProps,
  useContext,
} from 'solid-js';

type ScrollDirection = 'left' | 'right';

type AdaptiveScrollerContextValue = {
  setViewport: (element: HTMLElement) => void;
  canScrollLeft: () => boolean;
  canScrollRight: () => boolean;
  scroll: (direction: ScrollDirection) => void;
  updateScrollState: () => void;
};

const AdaptiveScrollerContext = createContext<AdaptiveScrollerContextValue>();

function useAdaptiveScroller() {
  const context = useContext(AdaptiveScrollerContext);
  if (!context) {
    throw new Error('AdaptiveScroller components must be used inside AdaptiveScroller');
  }
  return context;
}

function AdaptiveScrollerRoot(props: {
  children: JSX.Element;
  class?: string;
  scrollAmount?: number;
  onViewportReady?: (viewport: HTMLElement) => void;
}) {
  let viewport: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;

  const [canScrollLeft, setCanScrollLeft] = createSignal(false);
  const [canScrollRight, setCanScrollRight] = createSignal(false);

  const updateScrollState = () => {
    if (!viewport) return;
    setCanScrollLeft(viewport.scrollLeft > 0);
    setCanScrollRight(
      Math.ceil(viewport.scrollLeft + viewport.clientWidth) <
        viewport.scrollWidth
    );
  };

  const observeViewportContent = () => {
    if (!viewport || !resizeObserver) return;

    resizeObserver.disconnect();
    resizeObserver.observe(viewport);
    for (const child of Array.from(viewport.children)) {
      resizeObserver.observe(child);
    }
    queueMicrotask(updateScrollState);
  };

  const setViewport = (element: HTMLElement) => {
    viewport = element;

    resizeObserver?.disconnect();
    mutationObserver?.disconnect();

    resizeObserver = new ResizeObserver(updateScrollState);
    mutationObserver = new MutationObserver(observeViewportContent);
    mutationObserver.observe(element, { childList: true, subtree: true });

    observeViewportContent();
    props.onViewportReady?.(element);
  };

  const scroll = (direction: ScrollDirection) => {
    viewport?.scrollBy({
      left:
        direction === 'left'
          ? -(props.scrollAmount ?? 280)
          : (props.scrollAmount ?? 280),
      behavior: 'smooth',
    });
  };

  onMount(() => queueMicrotask(updateScrollState));

  onCleanup(() => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
  });

  return (
    <AdaptiveScrollerContext.Provider
      value={{
        setViewport,
        canScrollLeft,
        canScrollRight,
        scroll,
        updateScrollState,
      }}
    >
      <div class={props.class}>{props.children}</div>
    </AdaptiveScrollerContext.Provider>
  );
}

function AdaptiveScrollerViewport(
  props: JSX.HTMLAttributes<HTMLDivElement> & { children: JSX.Element }
) {
  const context = useAdaptiveScroller();
  const [local, rest] = splitProps(props, ['class', 'children', 'onScroll']);

  return (
    <div
      ref={context.setViewport}
      class={cn(
        'flex snap-x gap-2 overflow-x-auto scrollbar-hidden',
        local.class
      )}
      onScroll={(event) => {
        context.updateScrollState();
        local.onScroll?.(event);
      }}
      {...rest}
    >
      {local.children}
    </div>
  );
}

function AdaptiveScrollerItem(
  props: JSX.HTMLAttributes<HTMLDivElement> & { children: JSX.Element }
) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('shrink-0 snap-start', local.class)} {...rest}>
      {local.children}
    </div>
  );
}

function AdaptiveScrollerControl(props: {
  direction: ScrollDirection;
  class?: string;
}) {
  const context = useAdaptiveScroller();
  const disabled = () =>
    props.direction === 'left'
      ? !context.canScrollLeft()
      : !context.canScrollRight();

  return (
    <Button
      variant="base"
      size="icon-md"
      depth={3}
      disabled={disabled()}
      class={cn('rounded-full bg-surface shadow-sm', props.class)}
      aria-label={`Scroll ${props.direction}`}
      onClick={() => context.scroll(props.direction)}
    >
      <Show when={props.direction === 'left'} fallback={<ArrowRightIcon />}>
        <ArrowLeftIcon />
      </Show>
    </Button>
  );
}

function AdaptiveScrollerControls(
  props: JSX.HTMLAttributes<HTMLDivElement> & { children: JSX.Element }
) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('flex items-center justify-end gap-2', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
}

function AdaptiveScrollerFadeEdges(props: {
  class?: string;
  leftClass?: string;
  rightClass?: string;
}) {
  const context = useAdaptiveScroller();

  return (
    <div
      class={cn('pointer-events-none absolute inset-y-0 inset-x-0', props.class)}
      aria-hidden="true"
    >
      <div
        class={cn(
          'absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-surface to-transparent opacity-0 transition',
          context.canScrollLeft() && 'opacity-100',
          props.leftClass
        )}
      />
      <div
        class={cn(
          'absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface to-transparent opacity-0 transition',
          context.canScrollRight() && 'opacity-100',
          props.rightClass
        )}
      />
    </div>
  );
}

export const AdaptiveScroller = Object.assign(AdaptiveScrollerRoot, {
  Viewport: AdaptiveScrollerViewport,
  Item: AdaptiveScrollerItem,
  Control: AdaptiveScrollerControl,
  Controls: AdaptiveScrollerControls,
  FadeEdges: AdaptiveScrollerFadeEdges,
});
