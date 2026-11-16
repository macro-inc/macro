import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { type ParentProps, Show } from 'solid-js';

/**
 * The canvas's bottom chrome: a row of islands above the dock, in the slot
 * the page's New button otherwise takes. It steps aside for the keyboard,
 * as the dock does.
 *
 * A page without the app's bottom chrome (a public link opened signed out)
 * has no float regions to contribute to, so the islands sit at the bottom of
 * the canvas itself there.
 */
export function MobileCanvasChrome(props: ParentProps) {
  return (
    <Show
      when={FloatRegions.mount('accessory')}
      fallback={
        <Show when={!virtualKeyboardVisible()}>
          <div class="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col items-center gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter) pb-[calc(var(--safe-bottom,0px)+var(--mobile-chrome-gutter))]">
            {props.children}
          </div>
        </Show>
      }
    >
      <FloatRegion region="accessory" active={() => !virtualKeyboardVisible()}>
        <div class="flex flex-col items-center gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter)">
          {props.children}
        </div>
      </FloatRegion>
    </Show>
  );
}
