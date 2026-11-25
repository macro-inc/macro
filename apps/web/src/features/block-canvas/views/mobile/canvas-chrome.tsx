import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { followContentInsetBottom } from '@core/mobile/viewport-insets';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { type ParentProps, Show } from 'solid-js';

/** Screen pixels a fit leaves around the content on touch. */
const FIT_PADDING = 24;

/**
 * The canvas's bottom chrome: a row of islands above the dock, in the slot
 * the page's New button otherwise takes. It steps aside for the keyboard,
 * as the dock does.
 *
 * It also lays the frame over the part of the canvas that stays clear,
 * between the header and the bottom chrome, and hands it to `frame` so that
 * fits go there and nothing is fitted under a toolbar.
 *
 * A page without the app's bottom chrome (a public link opened signed out)
 * has no float regions to contribute to, so the islands sit at the bottom of
 * the canvas itself there and the frame ends above them.
 */
export function MobileCanvasChrome(
  props: ParentProps<{
    frame: (element: HTMLElement, padding: number) => void;
    /** Room a side panel takes at the right edge, as a CSS length. */
    clearRight?: string;
  }>
) {
  const frame = (element: HTMLElement) => props.frame(element, FIT_PADDING);
  return (
    <Show
      when={FloatRegions.mount('accessory')}
      fallback={
        <div class="pointer-events-none absolute inset-0 z-40 flex flex-col pt-[var(--mobile-content-inset-top,0px)]">
          <div
            ref={frame}
            aria-hidden="true"
            class="min-h-0 flex-1"
            style={{ 'margin-right': props.clearRight ?? '0px' }}
          />
          <Show when={!virtualKeyboardVisible()}>
            <div class="flex flex-col items-center gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter) pb-[calc(var(--safe-bottom,0px)+var(--mobile-chrome-gutter))]">
              {props.children}
            </div>
          </Show>
        </div>
      }
    >
      <div
        ref={(element) => {
          frame(element);
          followContentInsetBottom(element);
        }}
        aria-hidden="true"
        class="pointer-events-none absolute top-[var(--mobile-content-inset-top,0px)] bottom-[var(--mobile-content-inset-bottom,0px)] left-0"
        style={{ right: props.clearRight ?? '0px' }}
      />
      <FloatRegion region="accessory" active={() => !virtualKeyboardVisible()}>
        <div class="flex flex-col items-center gap-(--mobile-chrome-gutter) px-(--mobile-chrome-gutter)">
          {props.children}
        </div>
      </FloatRegion>
    </Show>
  );
}
