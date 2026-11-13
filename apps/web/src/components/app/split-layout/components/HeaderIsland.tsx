import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ComponentProps, Show, splitProps } from 'solid-js';
import { MobileHeaderIsland } from '../../mobile-header/island';

/**
 * Legacy island boundary for headers that one component builds for both
 * desktop and touch: children render directly on desktop and inside a floating
 * pill on touch. New code gives the view a mobile composition and uses
 * `MobileHeader.Island` there instead.
 *
 * Note: crossing the mobile breakpoint remounts children.
 */
export function HeaderIsland(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['children']);

  return (
    <Show when={isTouchDevice()} fallback={local.children}>
      <MobileHeaderIsland {...rest}>{local.children}</MobileHeaderIsland>
    </Show>
  );
}
