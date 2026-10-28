import {
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from 'solid-js';

const GUTTER = 10;
const THUMB = 4;
const INSET = (GUTTER - THUMB) / 2;
const MIN_THUMB = 24;
type Axis = 'horizontal' | 'vertical';
type Metrics = {
  overflow: number;
  size: number;
  travel: number;
  offset: number;
};
const emptyMetrics = (): Metrics => ({
  overflow: 0,
  size: 0,
  travel: 0,
  offset: 0,
});

type ScrollProps = JSX.HTMLAttributes<HTMLDivElement> & {
  scrollRef?: (element: HTMLDivElement) => void;
  /** Controls scrolling, independently of scrollbar visibility. */
  orientation?: Axis | 'both';
  /** Which custom scrollbars to show when their content overflows. */
  scrollbars?: Axis | 'both' | 'none';
  /** Reserve space above the vertical scrollbar without changing the scroll viewport. */
  verticalScrollbarInset?: number;
  autoHide?: boolean;
  autoHideDelay?: number;
  /** Opt in to hover-only reveal instead of revealing on scrolling and mount. */
  revealOn?: 'scroll' | 'hover';
  /** Include an enclosing surface, such as a lane header, in the hover area. */
  hovered?: boolean;
  /** Disable for content-height flex layouts, such as Kanban lanes. */
  fill?: boolean;
  viewportProps?: Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    'ref' | 'children'
  > & {
    [key: `data-${string}`]: string | undefined;
  };
  contentProps?: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'ref' | 'children'>;
};

function styles(
  base: JSX.CSSProperties,
  overrides: JSX.CSSProperties | string | undefined
) {
  if (typeof overrides === 'string') {
    return (
      Object.entries(base)
        .map(([key, value]) => `${key}:${value ?? ''}`)
        .join(';') +
      ';' +
      overrides
    );
  }

  return { ...base, ...overrides };
}

/** Defaults retain the original vertical, auto-hiding scrollbar and full-height layout. */
export function Scroll(props: ScrollProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'scrollRef',
    'orientation',
    'scrollbars',
    'autoHide',
    'verticalScrollbarInset',
    'autoHideDelay',
    'revealOn',
    'hovered',
    'fill',
    'viewportProps',
    'contentProps',
    'style',
  ]);
  const [metrics, setMetrics] = createSignal<Record<Axis, Metrics>>({
    horizontal: emptyMetrics(),
    vertical: emptyMetrics(),
  });
  const [visible, setVisible] = createSignal(false);
  const [rootHovered, setRootHovered] = createSignal(false);
  const [trackHovered, setTrackHovered] = createSignal(false);
  const isHovered = () =>
    rootHovered() || trackHovered() || local.hovered === true;
  let viewport!: HTMLDivElement;
  let content!: HTMLDivElement;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const enabled = (axis: Axis) =>
    !local.orientation ||
    local.orientation === 'both' ||
    local.orientation === axis;
  const shown = (axis: Axis) => {
    const visibility = local.scrollbars ?? 'vertical';
    return enabled(axis) && (visibility === 'both' || visibility === axis);
  };

  const verticalInset = (corner: number) => {
    const inset = local.verticalScrollbarInset ?? 0;
    return Number.isFinite(inset)
      ? Math.min(
          Math.max(0, inset),
          Math.max(0, (viewport?.clientHeight ?? 0) - corner)
        )
      : 0;
  };
  function configure() {
    if (!viewport) {
      return;
    }

    const x = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const y = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const measure = (axis: Axis): Metrics => {
      const horizontal = axis === 'horizontal';
      const other = horizontal ? 'vertical' : 'horizontal';
      const length = horizontal ? viewport.clientWidth : viewport.clientHeight;
      const total = horizontal ? viewport.scrollWidth : viewport.scrollHeight;
      const overflow = horizontal ? x : y;
      const otherOverflow = horizontal ? y : x;
      const corner = shown(other) && otherOverflow > 0 ? GUTTER : 0;
      const inset = horizontal ? 0 : verticalInset(corner);
      const track = Math.max(0, length - corner - inset - INSET * 2);
      const size = Math.min(
        track,
        Math.max(MIN_THUMB, total ? (track * length) / total : track)
      );
      const travel = Math.max(0, track - size);
      const scroll = horizontal ? viewport.scrollLeft : viewport.scrollTop;
      return {
        overflow,
        size,
        travel,
        offset: overflow ? (Math.max(0, scroll) / overflow) * travel : 0,
      };
    };
    setMetrics({
      horizontal: measure('horizontal'),
      vertical: measure('vertical'),
    });
  }

  function reveal() {
    if (local.revealOn === 'hover' && !isHovered()) {
      return;
    }
    clearTimeout(timer);
    setVisible(true);

    if (
      local.autoHide !== false &&
      !(local.revealOn === 'hover' && isHovered())
    ) {
      timer = setTimeout(
        () => setVisible(false),
        Math.max(0, local.autoHideDelay ?? 500)
      );
    }
  }

  function handleScroll() {
    configure();
    reveal();
  }

  onMount(() => {
    const root = viewport.parentElement;
    const enter = () => setRootHovered(true);
    const leave = () => setRootHovered(false);
    root?.addEventListener('pointerenter', enter);
    root?.addEventListener('pointerleave', leave);
    const observer = new ResizeObserver(configure);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener('scroll', handleScroll);
    configure();

    onCleanup(() => {
      root?.removeEventListener('pointerenter', enter);
      root?.removeEventListener('pointerleave', leave);
      observer.disconnect();
      viewport.removeEventListener('scroll', handleScroll);
      clearTimeout(timer);
    });
  });

  createEffect(() => {
    local.orientation;
    local.scrollbars;
    local.verticalScrollbarInset;
    local.autoHide;
    local.autoHideDelay;
    configure();
    reveal();
  });

  createEffect(() => {
    if (local.revealOn !== 'hover') {
      return;
    }

    clearTimeout(timer);

    if (isHovered()) {
      setVisible(true);
      return;
    }

    timer = setTimeout(
      () => setVisible(false),
      Math.max(0, local.autoHideDelay ?? 500)
    );
  });

  return (
    <div
      {...rest}
      style={styles(
        {
          position: 'relative',
          display: 'flex',
          'flex-direction': 'column',
          'min-height': '0',
          'min-width': '0',
          height: local.fill === false ? undefined : '100%',
          width: '100%',
        },
        local.style
      )}
    >
      <div
        {...local.viewportProps}
        ref={(element) => {
          viewport = element;
          local.scrollRef?.(element);
        }}
        style={styles(
          {
            'scrollbar-width': 'none',
            'min-height': '0',
            'min-width': '0',
            flex: '1 1 auto',
            'overflow-x': enabled('horizontal') ? 'auto' : 'hidden',
            'overflow-y': enabled('vertical') ? 'auto' : 'hidden',
            height: local.fill === false ? undefined : '100%',
          },
          local.viewportProps?.style
        )}
      >
        <div {...local.contentProps} ref={content}>
          {local.children}
        </div>
      </div>
      <For each={['horizontal', 'vertical'] as const}>
        {(axis) => {
          const horizontal = axis === 'horizontal';
          let gutter!: HTMLDivElement;
          let grab = 0;
          const [dragging, setDragging] = createSignal(false);
          const [focused, setFocused] = createSignal(false);
          const current = () => metrics()[axis];
          const other = () => metrics()[horizontal ? 'vertical' : 'horizontal'];
          const corner = () =>
            shown(horizontal ? 'vertical' : 'horizontal') &&
            other().overflow > 0
              ? GUTTER
              : 0;
          const coordinate = (event: PointerEvent) => {
            const bounds = gutter.getBoundingClientRect();
            return horizontal
              ? event.clientX - bounds.left
              : event.clientY - bounds.top;
          };
          const seek = (position: number) => {
            const value = current();
            if (!value.travel) {
              return;
            }
            const scroll =
              (Math.max(0, Math.min(value.travel, position - grab - INSET)) /
                value.travel) *
              value.overflow;
            if (horizontal) {
              viewport.scrollLeft = scroll;
            } else {
              viewport.scrollTop = scroll;
            }
            handleScroll();
          };

          return (
            <Show when={shown(axis) && current().overflow > 0}>
              <div
                ref={gutter}
                role="scrollbar"
                aria-label={
                  horizontal ? 'Scroll horizontally' : 'Scroll vertically'
                }
                aria-orientation={axis}
                aria-valuemin={0}
                aria-valuemax={current().overflow}
                aria-valuenow={
                  current().travel
                    ? Math.round(
                        (current().offset / current().travel) *
                          current().overflow
                      )
                    : 0
                }
                tabindex={0}
                data-scrollbar={axis}
                onFocus={() => {
                  setFocused(true);
                  reveal();
                }}
                onBlur={() => {
                  setFocused(false);
                  reveal();
                }}
                onPointerEnter={() => {
                  setTrackHovered(true);
                  reveal();
                }}
                onPointerLeave={() => setTrackHovered(false)}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  gutter.setPointerCapture(event.pointerId);
                  setDragging(true);
                  const point = coordinate(event);
                  const start = current().offset + INSET;
                  grab =
                    point >= start && point <= start + current().size
                      ? point - start
                      : current().size / 2;
                  seek(point);
                }}
                onLostPointerCapture={() => {
                  setDragging(false);
                  reveal();
                }}
                onPointerMove={(event) => {
                  if (gutter.hasPointerCapture(event.pointerId)) {
                    seek(coordinate(event));
                  }
                }}
                onPointerUp={(event) => {
                  if (gutter.hasPointerCapture(event.pointerId)) {
                    gutter.releasePointerCapture(event.pointerId);
                  }
                  reveal();
                }}
                onKeyDown={(event) => {
                  const negative = horizontal ? 'ArrowLeft' : 'ArrowUp';
                  const positive = horizontal ? 'ArrowRight' : 'ArrowDown';
                  const position = horizontal
                    ? viewport.scrollLeft
                    : viewport.scrollTop;
                  let next: number;

                  if (event.key === negative) {
                    next = position - 40;
                  } else if (event.key === positive) {
                    next = position + 40;
                  } else if (event.key === 'Home') {
                    next = 0;
                  } else if (event.key === 'End') {
                    next = current().overflow;
                  } else {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  const bounded = Math.max(
                    0,
                    Math.min(current().overflow, next)
                  );

                  if (horizontal) {
                    viewport.scrollLeft = bounded;
                  } else {
                    viewport.scrollTop = bounded;
                  }
                  handleScroll();
                }}
                style={{
                  position: 'absolute',
                  right: horizontal ? `${corner()}px` : '0',
                  bottom: horizontal ? '0' : `${corner()}px`,
                  left: horizontal ? '0' : undefined,
                  top: horizontal ? undefined : `${verticalInset(corner())}px`,
                  width: horizontal ? undefined : `${GUTTER}px`,
                  height: horizontal ? `${GUTTER}px` : undefined,
                  'touch-action': 'none',
                  'z-index': 1,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    'pointer-events': 'none',
                    left: horizontal ? '0' : `${INSET}px`,
                    top: horizontal ? `${INSET}px` : '0',
                    width: `${horizontal ? current().size : THUMB}px`,
                    height: `${horizontal ? THUMB : current().size}px`,
                    transform: `translate${horizontal ? 'X' : 'Y'}(${current().offset + INSET}px)`,
                    'border-radius': `${THUMB / 2}px`,
                    'background-color': 'var(--color-content-4)',
                    opacity:
                      local.autoHide === false ||
                      visible() ||
                      dragging() ||
                      focused()
                        ? 1
                        : 0,
                    transition: 'opacity 150ms ease-in-out',
                  }}
                />
              </div>
            </Show>
          );
        }}
      </For>
    </div>
  );
}
