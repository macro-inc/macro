import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getSafeAreaInset } from '@core/mobile/safeAreaInsets';
import { autoUpdate } from '@floating-ui/dom';
import { Layer } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { useFloatRegionAnchor } from './float-regions/FloatRegionScope';

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
 * otherwise paints flat. Panes clip their content, and split panes contain
 * `fixed` descendants, so the column part is portaled to the app root at the
 * fade's measured position. That keeps it under sheets and menus, which
 * portal to the body.
 *
 * A portaled column does not hide with its pane, so it follows the pane's
 * activity the way floating chrome does: a list parked under its detail, a
 * pane swiped into the background, or a parked split draws none.
 */
function SafeAreaColumnFades(props: {
  fade: Accessor<HTMLElement | undefined>;
}) {
  const panel = useSplitPanel();
  const region = useFloatRegionAnchor();
  const active = () =>
    (panel?.isPanelActive() ?? true) && (region?.isActive() ?? true);
  const [placement, setPlacement] = createSignal<ColumnPlacement>();
  createEffect(() => {
    const fade = props.fade();
    if (!fade || !active()) {
      setPlacement(undefined);
      return;
    }
    // Re-measure whenever the fade resizes or moves: folding, a side safe
    // area appearing, a pane sliding back into place after a swipe, or the
    // frame's padding swapping sides when the phone turns over. autoUpdate
    // watches moves (layout shift, where IntersectionObserver exists) and
    // window resizes; its element resize handling expects a separate
    // floating element, so the fade's own size is observed here.
    const measure = () => setPlacement(columnPlacement(fade));
    onCleanup(
      autoUpdate(fade, fade, measure, {
        ancestorScroll: false,
        elementResize: false,
      })
    );
    if (typeof ResizeObserver !== 'function') return;
    const resizes = new ResizeObserver(measure);
    resizes.observe(fade);
    onCleanup(() => resizes.disconnect());
  });
  return (
    <Show when={placement()}>
      {(columns) => (
        <Portal mount={document.getElementById('root') ?? document.body}>
          <Layer depth={0}>
            <For each={columns().sides}>
              {(side) => (
                <div
                  data-mobile-top-edge-fade-column
                  class="pointer-events-none fixed z-0"
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

/** The side safe areas a shown fade reaches, if any. */
function columnPlacement(
  fade: HTMLElement | undefined
): ColumnPlacement | undefined {
  if (!fade?.isConnected) return undefined;
  const left = getSafeAreaInset('left');
  const right = getSafeAreaInset('right');
  if (left === 0 && right === 0) return undefined;
  const rect = fade.getBoundingClientRect();
  if (rect.height === 0) return undefined;
  if (getComputedStyle(fade).visibility !== 'visible') return undefined;
  // Where the pane rests: a swipe moves panes with transforms, and the one it
  // reveals turns active (and is measured) before its transform is cleared,
  // which nothing would report.
  const shift = ancestorTranslation(fade);
  const restingLeft = rect.left - shift.x;
  const restingRight = rect.right - shift.x;
  const sides: SafeColumn[] = [];
  if (left > 0 && restingLeft <= left + 1) sides.push({ left: 0, width: left });
  if (right > 0 && restingRight >= window.innerWidth - right - 1)
    sides.push({ left: window.innerWidth - right, width: right });
  if (sides.length === 0) return undefined;
  return { top: rect.top - shift.y, height: rect.height, sides };
}

/** The translation the element and its ancestors' transforms add. */
function ancestorTranslation(element: HTMLElement) {
  let x = 0;
  let y = 0;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const transform = getComputedStyle(node).transform;
    if (!transform || transform === 'none') continue;
    const matrix = new DOMMatrixReadOnly(transform);
    x += matrix.e;
    y += matrix.f;
  }
  return { x, y };
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
