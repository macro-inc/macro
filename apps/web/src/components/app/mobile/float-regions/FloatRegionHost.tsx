import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { publishContentInsetBottom } from '@core/mobile/viewport-insets';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isPlatform } from '@core/util/platform';
import { autoUpdate } from '@floating-ui/dom';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn, Layer } from '@ui';
import { createEffect, createSignal, For, on, onCleanup } from 'solid-js';
import { FLOAT_REGIONS, FloatRegions } from './float-region-state';

/**
 * The mobile bottom-chrome host: an ordered stack of floating regions
 * (`accessory`, live `call`, then `dock`) anchored to the layout bottom.
 * Positioned `absolute` (not `fixed`) so the --dvh squish from
 * useAppSquishHandlers lifts the whole stack above the virtual keyboard.
 *
 * Publishes its height as `--mobile-content-inset-bottom` to the content that
 * needs bottom clearance (`followContentInsetBottom`), never on <html>: the
 * height changes with the keyboard and every composer line, and a property
 * on the root restyles every element. Empty regions collapse (`empty:hidden`),
 * so the value tracks what is actually visible.
 */
export function FloatRegionHost(props: {
  navigationEdge?: 'left' | 'right' | 'bottom';
}) {
  const [hostRef, setHostRef] = createSignal<HTMLDivElement>();
  const size = createElementSize(hostRef);
  const [accessoryBounds, setAccessoryBounds] = createSignal<{
    anchor: HTMLElement;
    left: number;
    width: number;
  }>();
  const measureAccessory = () => {
    const host = hostRef();
    const anchor = FloatRegions.anchor('accessory');
    if (!host || !anchor) return;
    const hostBounds = host.getBoundingClientRect();
    const paneBounds = anchor.getBoundingClientRect();
    const left = Math.max(hostBounds.left, paneBounds.left);
    const right = Math.min(hostBounds.right, paneBounds.right);
    setAccessoryBounds({
      anchor,
      left: left - hostBounds.left,
      width: Math.max(0, right - left),
    });
  };
  createEffect(
    on(
      [
        hostRef,
        () => FloatRegions.anchor('accessory'),
        () => props.navigationEdge,
      ],
      ([host, anchor]) => {
        if (!host || !anchor) return;
        // Pane swaps and sidebar animations can move a pane without resizing it.
        onCleanup(
          autoUpdate(anchor, host, measureAccessory, { animationFrame: true })
        );
      }
    )
  );
  const accessoryStyle = () => {
    const bounds = accessoryBounds();
    if (!bounds || bounds.anchor !== FloatRegions.anchor('accessory')) return;
    return { 'margin-left': `${bounds.left}px`, width: `${bounds.width}px` };
  };

  createEffect(() => {
    const height = size.height ?? 0;
    FloatRegions.setHostHeight(height);
    publishContentInsetBottom(height);
  });
  onCleanup(() => {
    FloatRegions.setHostHeight(0);
    publishContentInsetBottom(undefined);
  });

  return (
    <Layer depth={3}>
      <div
        ref={setHostRef}
        style={{
          left: `calc(var(--safe-left, 0px) + ${props.navigationEdge === 'left' ? 'var(--native-navigation-content-inset, calc(var(--mobile-chrome-button-size) + 2 * var(--mobile-chrome-gutter)))' : '0px'})`,
          right: `calc(var(--safe-right, 0px) + ${props.navigationEdge === 'right' ? 'var(--native-navigation-content-inset, calc(var(--mobile-chrome-button-size) + 2 * var(--mobile-chrome-gutter)))' : '0px'})`,
        }}
        class={cn(
          // The stack's own spacing rides the px --mobile-chrome-* vars
          // (see index.css): chrome must not track the OS text-size setting.
          // Only the chrome pins itself — accessory contributions (compose /
          // reply bars) keep rem sizing.
          'pointer-events-none absolute inset-x-0 bottom-0 z-mobile-nav-bar flex flex-col gap-(--mobile-chrome-gutter) pb-(--mobile-chrome-gutter)',
          isNativeMobilePlatform() &&
            (props.navigationEdge === 'left' || props.navigationEdge === 'right'
              ? 'pb-[max(var(--mobile-chrome-gutter),var(--safe-bottom,0px))]'
              : 'pb-[max(28px,var(--safe-bottom,0px))]'),
          isPlatform('android') &&
            'pb-[calc(var(--safe-bottom,0px)+var(--mobile-chrome-gutter))]',
          virtualKeyboardVisible() && 'pb-(--mobile-chrome-gutter)'
        )}
      >
        <For each={FLOAT_REGIONS}>
          {(region) => (
            <div
              data-float-region={region}
              ref={(el) => FloatRegions.setMount(region, el)}
              class={cn(
                'flex w-full flex-col empty:hidden',
                // Solid's Portal adds a wrapper between this slot and the dock.
                region === 'dock' &&
                  props.navigationEdge !== 'bottom' &&
                  props.navigationEdge !== undefined &&
                  '[&>div]:h-full [&>div]:min-h-0'
              )}
              style={
                region === 'accessory'
                  ? accessoryStyle()
                  : region === 'dock' &&
                      (props.navigationEdge === 'left' ||
                        props.navigationEdge === 'right')
                    ? {
                        position: 'fixed',
                        top: 'var(--native-navigation-top, calc(var(--safe-top, 0px) + var(--mobile-chrome-gutter)))',
                        bottom:
                          'var(--native-navigation-bottom, calc(var(--safe-bottom, 0px) + var(--mobile-chrome-gutter)))',
                        left:
                          props.navigationEdge === 'left'
                            ? 'var(--native-navigation-left, calc(var(--safe-left, 0px) + var(--mobile-chrome-gutter)))'
                            : undefined,
                        right:
                          props.navigationEdge === 'right'
                            ? 'var(--native-navigation-right, calc(var(--safe-right, 0px) + var(--mobile-chrome-gutter)))'
                            : undefined,
                        width: 'var(--mobile-chrome-button-size)',
                        'justify-content': 'flex-end',
                      }
                    : undefined
              }
            />
          )}
        </For>
      </div>
    </Layer>
  );
}
