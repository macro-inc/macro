import { children, type JSX, type ParentProps, Show } from 'solid-js';
import { isMobile } from './isMobile';

/**
 * Applies `wrapper` on non-mobile, renders children unwrapped on mobile..
 */
export function WrapUnlessMobile(
  props: ParentProps<{
    wrapper: (children: JSX.Element) => JSX.Element;
  }>
) {
  const resolved = children(() => props.children);
  return (
    <Show when={!isMobile()} fallback={resolved()}>
      {props.wrapper(resolved() as JSX.Element)}
    </Show>
  );
}
