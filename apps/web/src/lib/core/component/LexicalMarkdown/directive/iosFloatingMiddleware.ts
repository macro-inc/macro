import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { getSafeAreaInset } from '@core/mobile/safeAreaInsets';
import { virtualKeyboardHeight } from '@core/mobile/virtualKeyboard';
import { type Placement, size } from '@floating-ui/dom';
import { isIOS } from '@solid-primitives/platform';

// iOS web, and both native apps, keep the viewport under the keyboard and
// publish its height instead of shrinking the visual viewport.
function keyboardOverlaysViewport() {
  return isIOS || isNativeMobilePlatform();
}

/**
 * Returns keyboard-aware safe-padding, incorporating the safe area insets and virtual keyboard height.
 */
export function iosSafePadding(
  spacing: number
): number | { top: number; right: number; bottom: number; left: number } {
  if (!keyboardOverlaysViewport()) return spacing;
  return {
    top: spacing + getSafeAreaInset('top'),
    right: spacing + getSafeAreaInset('right'),
    bottom: spacing + (virtualKeyboardHeight() ?? getSafeAreaInset('bottom')),
    left: spacing + getSafeAreaInset('left'),
  };
}

/**
 * Returns a size middleware that accounts for the overlaid keyboard height and safe
 * area insets when computing available height, and calls onAvailableHeight with
 * the usable height.
 * (which can be used to, e.g. set a signal with available height)
 */
export function iosSizeMiddleware(
  spacing: number,
  onAvailableHeight: (height: number) => void
) {
  return size({
    padding: spacing,
    apply({
      availableHeight,
      elements,
      placement,
    }: {
      availableHeight: number;
      elements: { floating: HTMLElement };
      placement: Placement;
    }) {
      const safeAreaTop = placement.startsWith('top')
        ? getSafeAreaInset('top')
        : 0;
      const kbHeight =
        keyboardOverlaysViewport() && placement.startsWith('bottom')
          ? virtualKeyboardHeight()
          : 0;
      const h = Math.max(0, availableHeight - safeAreaTop - kbHeight);
      Object.assign(elements.floating.style, {
        maxHeight: `${h}px`,
      });
      onAvailableHeight(h - spacing);
    },
  });
}
