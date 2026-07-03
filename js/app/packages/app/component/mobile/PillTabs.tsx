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
  Show,
} from 'solid-js';
import { MobileTouchMenu } from './MobileTouchMenu';
import { computeVisiblePillValues } from './pillTabsLayout';
import { pressPulse } from './pressPulse';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

const PILL_CLASS =
  'h-10 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-medium island';

export type PillTabItem<T extends string = string> = {
  value: T;
  label: JSXElement;
};

/**
 * Horizontal strip of pill tabs — the shared mobile-chrome tab style used by
 * the dock's floating regions (soup-view tabs, search category filters) and
 * the settings bottom bar. Each option is its own island-styled pill.
 *
 * Presentational only: the caller owns selection state via `value`/`onChange`
 * and wraps this with its own layout (gutters, sibling controls, region
 * chrome). Pills that do not fit move into the overflow menu.
 */
export function PillTabs<T extends string>(props: {
  items: readonly PillTabItem<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  /**
   * Keep the active element focused when a pill is tapped (e.g. so an open
   * keyboard stays up in search) by preventing the pointer-down default.
   */
  preserveFocus?: boolean;
  /** Extra classes on the scroll strip. */
  class?: string;
}) {
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
    <div
      ref={setStripRef}
      class={cn(
        // The padding gives the pills' shadow room inside the clipping box;
        // the matching negative margin cancels its layout impact.
        'pointer-events-auto relative -my-3 flex w-full min-w-0 flex-1 max-w-full items-center gap-2 py-3 pr-2',
        props.class
      )}
    >
      <For each={visibleItems()}>
        {(item) => {
          const active = () => props.value === item.value;
          return (
            <button
              type="button"
              use:pressPulse
              data-checked={active() ? '' : undefined}
              class={cn(
                PILL_CLASS,
                active()
                  ? 'bg-accent text-surface ring-accent'
                  : 'text-ink-extra-muted'
              )}
              onPointerDown={(e) => {
                if (props.preserveFocus) e.preventDefault();
                hapticImpact('light');
              }}
              onClick={() => props.onChange(item.value)}
            >
              {item.label}
            </button>
          );
        }}
      </For>
      <Show when={overflowItems().length > 0}>
        <MobileTouchMenu
          triggerAriaLabel="More tabs"
          position="trigger-bottom"
          footerLabel="Tabs"
          items={overflowItems().map((item) => ({
            id: item.value,
            label: item.label,
            active: () => props.value === item.value,
            onSelect: () => props.onChange(item.value),
          }))}
          trigger={(trigger) => (
            <button
              type="button"
              use:pressPulse
              ref={trigger.ref}
              aria-label="More tabs"
              class="h-10 w-10 shrink-0 rounded-full text-ink-extra-muted island flex items-center justify-center [&_svg]:size-5"
              onPointerDown={(e) => {
                if (props.preserveFocus) e.preventDefault();
                trigger.onPointerDown();
              }}
              onClick={trigger.onClick}
              onTouchMove={trigger.onTouchMove}
              onTouchEnd={trigger.onTouchEnd}
            >
              <DotsThreeIcon />
            </button>
          )}
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
              class={PILL_CLASS}
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
