import { cn } from '@ui';
import type { JSX, ParentProps } from 'solid-js';

/**
 * The floating pill surface for dock controls. MobileDockButton renders flat
 * and always sits inside one of these —
 * alone for a single round button, or grouped so several share the pill:
 *
 * ```tsx
 * <MobileDockIsland class="h-(--mobile-chrome-button-size) justify-between gap-(--mobile-chrome-gap)">
 *   <MobileDockButton icon={BellIcon} … />
 *   <MobileDrawer>
 *     <MobileDrawer.Trigger as={MobileDockButton} icon={CaretUpIcon} … />
 *     …
 *   </MobileDrawer>
 * </MobileDockIsland>
 * ```
 *
 * The container re-enables pointer events for its children (the float-region
 * host is pointer-transparent); layout beyond the pill itself — height,
 * growth, distribution — is the caller's, via `class`.
 */
export function MobileDockIsland(
  props: ParentProps<{
    class?: string;
    ref?: (element: HTMLDivElement) => void;
    style?: JSX.CSSProperties;
  }>
) {
  return (
    <div
      ref={props.ref}
      style={props.style}
      data-mobile-dock-island
      class={cn(
        'island pointer-events-auto flex items-center rounded-full',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}
