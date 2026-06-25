import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn, Layer } from '@ui';
import { createEffect, createSignal, For, onCleanup } from 'solid-js';
import { FLOAT_REGIONS, FloatRegions } from './float-region-state';

/**
 * The mobile bottom-chrome host: an ordered stack of floating regions
 * (`accessory` above `dock`) anchored to the bottom of the layout root.
 * Positioned `absolute` (not `fixed`) so the --dvh squish from
 * useAppSquishHandlers lifts the whole stack above the virtual keyboard.
 *
 * Publishes its height as `--mobile-content-inset-bottom` on <html> for content that
 * needs bottom clearance. Empty regions collapse (`empty:hidden`), so the
 * variable tracks what is actually visible.
 */
export function FloatRegionHost() {
  const [hostRef, setHostRef] = createSignal<HTMLDivElement>();
  const size = createElementSize(hostRef);

  createEffect(() => {
    const height = size.height ?? 0;
    FloatRegions.setHostHeight(height);
    document.documentElement.style.setProperty(
      '--mobile-content-inset-bottom',
      `${height}px`
    );
  });
  onCleanup(() => {
    FloatRegions.setHostHeight(0);
    document.documentElement.style.removeProperty(
      '--mobile-content-inset-bottom'
    );
  });

  return (
    <Layer depth={3}>
      <div
        ref={setHostRef}
        class={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-mobile-nav-bar flex flex-col gap-3 pb-3',
          isNativeMobilePlatform() && 'pb-7',
          virtualKeyboardVisible() && 'pb-3'
        )}
      >
        <For each={FLOAT_REGIONS}>
          {(region) => (
            <div
              data-float-region={region}
              ref={(el) => FloatRegions.setMount(region, el)}
              class="flex w-full flex-col empty:hidden"
            />
          )}
        </For>
      </div>
    </Layer>
  );
}
