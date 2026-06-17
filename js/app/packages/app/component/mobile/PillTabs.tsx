import { hapticImpact } from '@core/mobile/haptics';
import { cn } from '@ui';
import { createEffect, For, type JSXElement, on } from 'solid-js';
import { pressPulse } from './pressPulse';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

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
 * chrome). The active pill is kept scrolled into view automatically.
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
  let stripRef: HTMLDivElement | undefined;

  // Keep the active pill scrolled into view within the horizontal strip.
  // Re-runs on selection change or when the list of items changes.
  createEffect(
    on(
      () => [props.value, props.items] as const,
      () => {
        const strip = stripRef;
        if (!strip) return;
        queueMicrotask(() => {
          const active = strip.querySelector<HTMLElement>('[data-checked]');
          if (!active) return;
          const stripRect = strip.getBoundingClientRect();
          const activeRect = active.getBoundingClientRect();
          if (activeRect.left < stripRect.left) {
            strip.scrollBy({
              left: activeRect.left - stripRect.left - 8,
              behavior: 'smooth',
            });
          } else if (activeRect.right > stripRect.right) {
            strip.scrollBy({
              left: activeRect.right - stripRect.right + 8,
              behavior: 'smooth',
            });
          }
        });
      }
    )
  );

  return (
    <div
      ref={stripRef}
      class={cn(
        // overflow-x:auto forces overflow-y to auto, which clips the pills'
        // shadow. The padding gives the shadow room inside the (clipping)
        // padding box; the matching negative margin cancels its layout impact.
        'pointer-events-auto -my-3 flex min-w-0 items-center gap-2 overflow-x-auto py-3 pr-2 scrollbar-hidden',
        props.class
      )}
    >
      <For each={props.items}>
        {(item) => {
          const active = () => props.value === item.value;
          return (
            <button
              type="button"
              use:pressPulse
              data-checked={active() ? '' : undefined}
              class={cn(
                'h-10 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium shadow-md',
                active()
                  ? 'bg-accent text-surface border-accent'
                  : 'bg-surface text-ink-extra-muted border-edge'
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
    </div>
  );
}
