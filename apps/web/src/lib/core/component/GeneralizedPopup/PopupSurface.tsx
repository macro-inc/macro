import { cn } from '@ui';
import type { JSX, Ref } from 'solid-js';

type PopupSurfaceProps = {
  children: JSX.Element;
  /** Extra classes merged over the default surface chrome. */
  class?: string;
  ref?: Ref<HTMLDivElement>;
};

const DEFAULT_SURFACE_CLASS =
  'border border-edge bg-surface shadow-xl rounded-lg z-highlight-menu inline-flex items-start flex-col p-1';

/**
 * Styling wrapper for popup content. Renders the standard popup chrome
 * (border, surface background, shadow, rounded corners, padding) around its
 * children. Positioning is left to the caller — pair with `PopupPositioner`.
 */
export function PopupSurface(props: PopupSurfaceProps) {
  return (
    <div
      ref={props.ref}
      id="generalized-popup"
      class={cn(DEFAULT_SURFACE_CLASS, props.class)}
    >
      {props.children}
    </div>
  );
}
