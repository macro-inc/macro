import { isPlatform } from '@core/util/platform';
import { Layer } from '@ui';
import { Show } from 'solid-js';

/**
 * Edge scrims for full-frame mobile: content dissolves into the page surface
 * as it scrolls beneath the floating chrome at the top and bottom
 */

/** Extra distance the gradients bleed past the chrome they cover. */
const TOP_FALLOFF = '0rem';
const BOTTOM_FALLOFF = '2rem';

export function MobileTopEdgeFade() {
  return (
    <Show when={isPlatform('ios')}>
      <Layer depth={0}>
        <div
          class="pointer-events-none absolute inset-x-0 top-0"
          style={{
            height: `calc(var(--mobile-content-inset-top, 0px) + ${TOP_FALLOFF})`,
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
