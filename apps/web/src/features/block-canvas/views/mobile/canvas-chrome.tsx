import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import type { ParentProps } from 'solid-js';

/**
 * The canvas's bottom chrome: a row of islands above the dock, in the slot
 * the page's New button otherwise takes. It steps aside for the keyboard,
 * as the dock does.
 */
export function MobileCanvasChrome(props: ParentProps) {
  return (
    <FloatRegion region="accessory" active={() => !virtualKeyboardVisible()}>
      <div class="flex flex-col items-center gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter)">
        {props.children}
      </div>
    </FloatRegion>
  );
}
