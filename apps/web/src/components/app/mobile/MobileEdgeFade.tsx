import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Layer } from '@ui';
import { Show } from 'solid-js';

/**
 * Edge scrims for full-frame mobile: content dissolves into the page surface
 * as it scrolls beneath the floating chrome at the top and bottom. The top
 * scrim follows `--mobile-content-inset-top`, so a pane with no top safe area
 * and no floating chrome above it draws none. Desktop split panes set that
 * inset to their in-flow header's height, so the top scrim draws only on
 * touch devices.
 */

/** Extra distance the gradients bleed past the chrome they cover. */
const TOP_FALLOFF = '32px';
const BOTTOM_FALLOFF = '32px';

export function MobileTopEdgeFade() {
  return (
    <Show when={isTouchDevice()}>
      <Layer depth={0}>
        <div
          data-mobile-top-edge-fade
          class="pointer-events-none absolute inset-x-0 top-0 z-1"
          style={{
            // No top chrome or safe area means nothing to dissolve under:
            // the falloff shrinks to 0 with the inset.
            height: `calc(var(--mobile-content-inset-top, 0px) + min(var(--mobile-content-inset-top, 0px) * 100, ${TOP_FALLOFF}))`,
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
