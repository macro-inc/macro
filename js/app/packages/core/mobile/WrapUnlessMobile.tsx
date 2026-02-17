import type { JSX, ParentProps } from 'solid-js';
import { isMobile } from './isMobile';

/**
 * Applies `wrapper` on non-mobile, renders children unwrapped on mobile.
 *
 * NOTE: The mobile check is NOT reactive. The branch is decided once at mount
 * time and will not update if the window is resized across the mobile
 * breakpoint. Only use this for layout differences that don't need to respond
 * to live resizing.
 */
export function WrapUnlessMobile(
  props: ParentProps<{
    wrapper: (children: JSX.Element) => JSX.Element;
  }>
) {
  if (!isMobile()) {
    return props.wrapper(props.children);
  }
  return props.children;
}
