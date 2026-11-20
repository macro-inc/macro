import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Layer } from '@ui';
import { Show } from 'solid-js';

/**
 * Edge scrims for full-frame touch views: content dissolves into the page
 * surface beneath floating chrome. The top scrim ends at the reserved content
 * inset, leaving the first row clear before scrolling. A zero inset draws
 * nothing. Desktop headers stay in flow, so desktop panes never draw it.
 */

/** Extra distance the bottom gradient bleeds above its chrome. */
const BOTTOM_FALLOFF = '32px';

export function MobileTopEdgeFade() {
  return (
    <Show when={isTouchDevice()}>
      <Layer depth={0}>
        <div
          data-mobile-top-edge-fade
          class="pointer-events-none absolute inset-x-0 top-0 z-1"
          style={{
            // Never bleed below the space reserved for floating top chrome.
            height: 'var(--mobile-content-inset-top, 0px)',
            background:
              'linear-gradient(to bottom, var(--color-surface) 10%, 70%, transparent)',
          }}
        />
      </Layer>
    </Show>
  );
}

/** Spans the bottom-chrome host plus a falloff above it. */
export function MobileBottomEdgeFade() {
  return (
    <Layer depth={0}>
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 -z-10"
        style={{
          top: `calc(${BOTTOM_FALLOFF} * -1)`,
          background:
            'linear-gradient(to top, var(--color-surface), 60%, transparent)',
        }}
      />
    </Layer>
  );
}
