import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getSafeAreaInset } from '@core/mobile/safeAreaInsets';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Layer } from '@ui';
import { type Accessor, createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

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

const TOP_FADE_BACKGROUND =
  'linear-gradient(to bottom, var(--color-surface) 10%, 70%, transparent)';

type SafeColumn = { left: number; width: number };

type ColumnPlacement = { top: number; height: number; sides: SafeColumn[] };

export function MobileTopEdgeFade() {
  const [fade, setFade] = createSignal<HTMLDivElement>();
  return (
    <Show when={isTouchDevice()}>
      <Layer depth={0}>
        <div
          ref={setFade}
          data-mobile-top-edge-fade
          class="pointer-events-none absolute inset-x-0 top-0 z-1"
          style={{
            // No top chrome or safe area means nothing to dissolve under:
            // the falloff shrinks to 0 with the inset.
            height: `calc(var(--mobile-content-inset-top, 0px) + min(var(--mobile-content-inset-top, 0px) * 100, ${TOP_FALLOFF}))`,
            background: TOP_FADE_BACKGROUND,
          }}
        />
        <SafeAreaColumnFades fade={fade} />
      </Layer>
    </Show>
  );
}

/**
 * A pane that reaches a side safe area (the iPhone Duo's clock and camera
 * column) continues its top fade across that column, which the app frame
 * otherwise paints flat. Panes clip their content, so the column part is
 * drawn outside them, at the fade's measured position.
 */
function SafeAreaColumnFades(props: {
  fade: Accessor<HTMLElement | undefined>;
}) {
  const [placement, setPlacement] = createSignal<ColumnPlacement>();
  const measure = () => setPlacement(columnPlacement(props.fade()));
  // Folding, rotating, or a side safe area appearing all resize the pane, and
  // with it the fade.
  createResizeObserver(props.fade, measure);
  return (
    <Show when={placement()}>
      {(columns) => (
        <Portal>
          <Layer depth={0}>
            <For each={columns().sides}>
              {(side) => (
                <div
                  data-mobile-top-edge-fade-column
                  class="pointer-events-none fixed"
                  style={{
                    top: `${columns().top}px`,
                    left: `${side.left}px`,
                    width: `${side.width}px`,
                    height: `${columns().height}px`,
                    background: TOP_FADE_BACKGROUND,
                  }}
                />
              )}
            </For>
          </Layer>
        </Portal>
      )}
    </Show>
  );
}

/** The side safe areas a visible fade reaches, if any. */
function columnPlacement(
  fade: HTMLElement | undefined
): ColumnPlacement | undefined {
  if (!fade?.isConnected) return undefined;
  if (
    !fade.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  )
    return undefined;
  const rect = fade.getBoundingClientRect();
  if (rect.height === 0) return undefined;
  const left = getSafeAreaInset('left');
  const right = getSafeAreaInset('right');
  const sides: SafeColumn[] = [];
  if (left > 0 && rect.left <= left + 1) sides.push({ left: 0, width: left });
  if (right > 0 && rect.right >= window.innerWidth - right - 1)
    sides.push({ left: window.innerWidth - right, width: right });
  if (sides.length === 0) return undefined;
  return { top: rect.top, height: rect.height, sides };
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
