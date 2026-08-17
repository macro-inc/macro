import { hapticImpact } from '@core/mobile/haptics';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSXElement,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { MobileTouchMenu } from './MobileTouchMenu';
import { computeVisiblePillValues } from './pillTabsLayout';
import { pressPulse } from './pressPulse';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

const PILL_CLASS =
  'h-10 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-medium island';

/** Square variant for icon-only pills (the label is the icon). */
const ICON_PILL_CLASS = 'flex w-10 items-center justify-center px-0';

const MENU_STRIP_CLASS =
  // The vertical padding gives the pills' shadow room inside the clipping
  // box; the matching negative margin cancels its layout impact.
  'pointer-events-auto relative -my-3 flex w-full min-w-0 flex-1 max-w-full items-center gap-2 py-3 pr-2';

const SCROLL_STRIP_CLASS =
  // The scrollport clips at its box, so the vertical padding must cover the
  // full light-mode island shadow bloom (4px offset + 8px spread + 20px blur
  // = 32px); the matching negative margin cancels its layout impact. The
  // strip is tap-transparent so the enlarged halo never swallows touches
  // meant for content behind it — the content row re-enables pointer events
  // for the pills. A pointer-events:none scroller receives no native scroll
  // gestures, so panning is driven from the content row's pointer events
  // instead (see the pan handler in ScrollablePillTabs).
  'pointer-events-none -my-8 flex w-full min-w-0 flex-1 max-w-full items-center overflow-x-auto py-8 scrollbar-hidden';

/** Momentum decay time constant after a pan release. */
const MOMENTUM_TIME_CONSTANT_MS = 325;
/** Momentum below this speed (px/ms) stops animating. */
const MOMENTUM_MIN_VELOCITY = 0.02;
/** Movement below this is a tap, not a pan. */
const PAN_SLOP_PX = 8;

export type PillTabItem<T extends string = string> = {
  value: T;
  label: JSXElement;
  /** Render as a compact square pill — pass the icon as `label`. */
  iconOnly?: boolean;
  /** Accessible name; required for icon-only pills. */
  ariaLabel?: string;
};

type PillTabsProps<T extends string> = {
  items: readonly PillTabItem<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  /**
   * Overflow strategy: by default pills that do not fit collapse into an
   * ellipsis menu; when set the strip scrolls horizontally instead and the
   * active pill is kept scrolled into view.
   */
  scrollable?: boolean;
  /** Extra classes on the scroll strip (the outer, clipping box). */
  class?: string;
  /**
   * Scrollable variant only: extra classes on the row that scrolls inside
   * the strip. Edge padding belongs here rather than on the strip so a
   * full-bleed strip scrolls its pills to the device edge and the padding
   * scrolls with the content (trailing padding on the scroll container
   * itself is also unreliable in WebKit).
   */
  contentClass?: string;
  /**
   * Scrollable variant only: rendered as the first child of the scroll
   * content, ahead of the pills. For a control pinned at the strip's start
   * while pills scroll beneath it (e.g. the filter-drawer button), give it
   * `sticky left-(--mobile-chrome-gutter) z-10` — the keep-active-in-view
   * logic accounts for a sticky leading element's width.
   */
  leading?: JSXElement;
};

/**
 * Horizontal strip of pill tabs — the shared mobile-chrome tab style used by
 * the dock's floating regions (view pills, soup-view tabs) and header strips.
 * Each option is its own island-styled pill.
 *
 * Presentational only: the caller owns selection state via `value`/`onChange`
 * and wraps this with its own layout (gutters, sibling controls, region
 * chrome).
 */
export function PillTabs<T extends string>(props: PillTabsProps<T>) {
  return (
    <Show
      when={props.scrollable}
      fallback={<MenuOverflowPillTabs {...props} />}
    >
      <ScrollablePillTabs {...props} />
    </Show>
  );
}

function PillButton<T extends string>(props: {
  item: PillTabItem<T>;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      use:pressPulse
      data-checked={props.active ? '' : undefined}
      aria-pressed={props.active}
      aria-label={props.item.ariaLabel}
      class={cn(
        PILL_CLASS,
        props.item.iconOnly && ICON_PILL_CLASS,
        props.active
          ? 'bg-accent text-surface ring-accent'
          : 'text-ink-extra-muted'
      )}
      onPointerDown={(e) => {
        e.preventDefault();
      }}
      // Haptic on activation, not on touch-down: a pan that starts on a pill
      // never activates it (the pan handler suppresses the click), so it must
      // not buzz either.
      onClick={() => {
        hapticImpact('light');
        props.onSelect();
      }}
    >
      {props.item.label}
    </button>
  );
}

function ScrollablePillTabs<T extends string>(props: PillTabsProps<T>) {
  const [stripRef, setStripRef] = createSignal<HTMLDivElement>();
  const [contentRef, setContentRef] = createSignal<HTMLDivElement>();

  // Horizontal panning, driven manually from the content row's pointer
  // events: the strip is pointer-events:none (so its shadow halo passes
  // touches through), which also opts it out of native scroll gestures.
  // Only gestures that begin on the pill row (the content row's box) pan;
  // a vertical start leaves the pointer alone, and capturing the pointer on
  // engage retargets the eventual click away from the pill underneath.
  createEffect(() => {
    const strip = stripRef();
    const content = contentRef();
    if (!strip || !content) return;

    let pointerId: number | undefined;
    let panning = false;
    let lastGestureWasPan = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let lastX = 0;
    let lastTime = 0;
    let velocity = 0; // px/ms in scrollLeft direction
    let momentumFrame: number | undefined;

    const stopMomentum = () => {
      if (momentumFrame !== undefined) cancelAnimationFrame(momentumFrame);
      momentumFrame = undefined;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      stopMomentum();
      pointerId = e.pointerId;
      panning = false;
      lastGestureWasPan = false;
      startX = lastX = e.clientX;
      startY = e.clientY;
      startScrollLeft = strip.scrollLeft;
      lastTime = e.timeStamp;
      velocity = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!panning) {
        if (Math.abs(dx) < PAN_SLOP_PX) return;
        if (Math.abs(dx) <= Math.abs(dy)) {
          // Vertical intent — not ours.
          pointerId = undefined;
          return;
        }
        panning = true;
        content.setPointerCapture(e.pointerId);
      }
      const dt = e.timeStamp - lastTime;
      if (dt > 0) {
        velocity = 0.8 * ((lastX - e.clientX) / dt) + 0.2 * velocity;
      }
      lastX = e.clientX;
      lastTime = e.timeStamp;
      strip.scrollLeft = startScrollLeft - dx;
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = undefined;
      if (!panning) return;
      panning = false;
      lastGestureWasPan = true;
      let v = velocity;
      let last = performance.now();
      const step = (now: number) => {
        const dt = now - last;
        last = now;
        strip.scrollLeft += v * dt;
        v *= Math.exp(-dt / MOMENTUM_TIME_CONSTANT_MS);
        const atEdge =
          strip.scrollLeft <= 0 ||
          strip.scrollLeft >= strip.scrollWidth - strip.clientWidth;
        momentumFrame =
          Math.abs(v) > MOMENTUM_MIN_VELOCITY && !atEdge
            ? requestAnimationFrame(step)
            : undefined;
      };
      momentumFrame = requestAnimationFrame(step);
    };

    // A pointer-events:none scroller misses trackpad/wheel scrolling too.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaX;
    };

    // A pan is not a tap: keep touchend watchers (usePreserveFocusOnButtonTaps
    // re-dispatches clicks for [data-keep-keyboard] buttons) from activating
    // the pill the finger happened to end on.
    const onTouchEnd = (e: TouchEvent) => {
      if (!lastGestureWasPan) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };

    content.addEventListener('pointerdown', onPointerDown);
    content.addEventListener('pointermove', onPointerMove);
    content.addEventListener('pointerup', onPointerEnd);
    content.addEventListener('pointercancel', onPointerEnd);
    content.addEventListener('wheel', onWheel, { passive: false });
    content.addEventListener('touchend', onTouchEnd, { passive: false });

    onCleanup(() => {
      stopMomentum();
      content.removeEventListener('pointerdown', onPointerDown);
      content.removeEventListener('pointermove', onPointerMove);
      content.removeEventListener('pointerup', onPointerEnd);
      content.removeEventListener('pointercancel', onPointerEnd);
      content.removeEventListener('wheel', onWheel);
      content.removeEventListener('touchend', onTouchEnd);
    });
  });

  // Keep the active pill scrolled into view as the selection or list changes,
  // snapping it inside the content row's edge padding rather than flush to
  // the strip edge.
  createEffect(
    on(
      () =>
        [
          props.value,
          props.items.map((item) => item.value).join('\u0000'),
        ] as const,
      () => {
        queueMicrotask(() => {
          const strip = stripRef();
          const active = strip?.querySelector<HTMLElement>('[data-checked]');
          if (!strip || !active) return;
          const content = strip.firstElementChild as HTMLElement | null;
          const contentStyle = content ? getComputedStyle(content) : undefined;
          const padLeft = Number.parseFloat(contentStyle?.paddingLeft || '0');
          const padRight = Number.parseFloat(contentStyle?.paddingRight || '0');
          const gap = Number.parseFloat(contentStyle?.columnGap || '0') || 0;
          // A sticky leading control stays pinned over the scrolled content,
          // so the snap origin moves past it.
          const leading = content?.firstElementChild as HTMLElement | null;
          const pinnedInset =
            leading && getComputedStyle(leading).position === 'sticky'
              ? leading.offsetWidth + gap
              : 0;
          const minLeft = padLeft + pinnedInset;
          // Rect arithmetic rather than offsetLeft: the strip is not
          // positioned (see SCROLL_STRIP_CLASS), so it is no offsetParent.
          const stripLeft = strip.getBoundingClientRect().left;
          const itemRect = active.getBoundingClientRect();
          const itemLeft = itemRect.left - stripLeft + strip.scrollLeft;
          const itemRight = itemLeft + itemRect.width;
          const viewRight = strip.scrollLeft + strip.clientWidth;
          if (itemLeft - minLeft < strip.scrollLeft) {
            strip.scrollTo({ left: itemLeft - minLeft, behavior: 'smooth' });
          } else if (itemRight + padRight > viewRight) {
            strip.scrollTo({
              left: itemRight + padRight - strip.clientWidth,
              behavior: 'smooth',
            });
          }
        });
      }
    )
  );

  return (
    <div ref={setStripRef} class={cn(SCROLL_STRIP_CLASS, props.class)}>
      <div
        ref={setContentRef}
        // Tapping a pill while typing (e.g. switching search scope) must not
        // drop the virtual keyboard — see usePreserveFocusOnButtonTaps.
        data-keep-keyboard
        class={cn(
          'pointer-events-auto touch-none select-none flex w-max shrink-0 items-center gap-2 pr-2',
          props.contentClass
        )}
      >
        {props.leading}
        <For each={props.items}>
          {(item) => (
            <PillButton
              item={item}
              active={props.value === item.value}
              onSelect={() => props.onChange(item.value)}
            />
          )}
        </For>
      </div>
    </div>
  );
}

/** Pills that do not fit move into an ellipsis overflow menu. */
function MenuOverflowPillTabs<T extends string>(props: PillTabsProps<T>) {
  const [stripRef, setStripRef] = createSignal<HTMLDivElement>();
  const [measureRef, setMeasureRef] = createSignal<HTMLDivElement>();
  const [overflowMeasureRef, setOverflowMeasureRef] =
    createSignal<HTMLButtonElement>();
  const stripSize = createElementSize(stripRef);
  const measureSize = createElementSize(measureRef);
  const overflowMeasureSize = createElementSize(overflowMeasureRef);
  const measuredButtons = new Map<T, HTMLButtonElement>();
  const [visibleValues, setVisibleValues] = createSignal<T[]>([]);
  const [measured, setMeasured] = createSignal(false);

  const itemKey = () => props.items.map((item) => item.value).join('\u0000');

  const getContentWidth = (el: HTMLElement) => {
    const style = window.getComputedStyle(el);
    return (
      el.clientWidth -
      Number.parseFloat(style.paddingLeft || '0') -
      Number.parseFloat(style.paddingRight || '0')
    );
  };

  const getGap = (el: HTMLElement) => {
    const style = window.getComputedStyle(el);
    return Number.parseFloat(style.columnGap || style.gap || '0') || 0;
  };

  const computeVisibleValues = () => {
    const strip = stripRef();
    const overflowButton = overflowMeasureRef();
    if (!strip || !overflowButton) return;

    const items = props.items;
    const values = items.map((item) => item.value);
    const widths = items.map(
      (item) => measuredButtons.get(item.value)?.offsetWidth ?? 0
    );

    if (items.length === 0 || widths.some((width) => width === 0)) {
      setVisibleValues(items.map((item) => item.value));
      setMeasured(false);
      return;
    }

    const available = getContentWidth(strip);
    const gap = getGap(strip);
    const overflowWidth = overflowButton.offsetWidth;
    setVisibleValues(
      computeVisiblePillValues({
        values,
        activeValue: props.value,
        currentVisibleValues: visibleValues(),
        widths,
        availableWidth: available,
        gap,
        overflowWidth,
      })
    );
    setMeasured(true);
  };

  createEffect(
    on(
      () =>
        [
          props.value,
          itemKey(),
          stripSize.width,
          measureSize.width,
          overflowMeasureSize.width,
        ] as const,
      () => {
        queueMicrotask(computeVisibleValues);
      }
    )
  );

  const visibleItems = createMemo(() => {
    if (!measured()) return props.items;
    const itemsByValue = new Map(props.items.map((item) => [item.value, item]));
    return visibleValues().flatMap((value) => {
      const item = itemsByValue.get(value);
      return item ? [item] : [];
    });
  });

  const overflowItems = createMemo(() => {
    if (!measured()) return [];
    const visible = new Set(visibleValues());
    return props.items.filter((item) => !visible.has(item.value));
  });

  return (
    <div ref={setStripRef} class={cn(MENU_STRIP_CLASS, props.class)}>
      <For each={visibleItems()}>
        {(item) => (
          <PillButton
            item={item}
            active={props.value === item.value}
            onSelect={() => props.onChange(item.value)}
          />
        )}
      </For>
      <Show when={overflowItems().length > 0}>
        <MobileTouchMenu
          triggerIcon={DotsThreeIcon}
          position="trigger-bottom"
          footerLabel="Tabs"
          items={overflowItems().map((item) => ({
            id: item.value,
            label: item.label,
            active: () => props.value === item.value,
            onSelect: () => props.onChange(item.value),
          }))}
        />
      </Show>
      <div
        ref={setMeasureRef}
        aria-hidden="true"
        class="pointer-events-none invisible absolute top-0 left-0 -z-10 flex w-max items-center gap-2 py-3 pr-2"
      >
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              ref={(el) => measuredButtons.set(item.value, el)}
              tabIndex={-1}
              class={cn(PILL_CLASS, item.iconOnly && ICON_PILL_CLASS)}
            >
              {item.label}
            </button>
          )}
        </For>
        <button
          type="button"
          ref={setOverflowMeasureRef}
          tabIndex={-1}
          class="h-10 w-10 shrink-0 rounded-full island"
        />
      </div>
    </div>
  );
}
