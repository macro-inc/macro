import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface, type SurfaceProps } from './Surface';

/** Shared desktop styling for composers, message cards, and compose dialogs. */
export function composerSurfaceClasses(
  options: { class?: string; enabled?: boolean } = {}
): string {
  return cn(
    !isTouchDevice() &&
      options.enabled !== false &&
      'rounded-[26.25px] border-0 bg-composer text-composer-ink dark-mode:glass-input backdrop-filter-none light-mode:after:hidden light-mode:shadow-[0_0_0_0.9375px_var(--color-drop-shadow),0_1.875px_7.5px_0_var(--color-drop-shadow),0_3.75px_75px_7.5px_color-mix(in_srgb,var(--color-drop-shadow)_60%,transparent)]',
    options.class
  );
}

/** Chat chrome on desktop; existing glass/island styling on touch devices. */
export function ComposerSurface(
  props: Omit<SurfaceProps, 'depth' | 'hideBorder'> & {
    appearance?: 'glass' | 'chat';
  }
) {
  const [local, rest] = splitProps(props, ['class', 'appearance']);
  return (
    <Surface
      {...rest}
      class={composerSurfaceClasses({
        enabled: local.appearance === 'chat',
        class: cn(
          'touch:rounded-3xl touch:island touch:bg-chrome',
          !isTouchDevice() &&
            local.appearance !== 'chat' &&
            'rounded-[22px] glass-input bg-menu-glass',
          local.class
        ),
      })}
      // Glass draws its own 1px rim; a Surface border would inset that rim
      // and create a second outline around the composer.
      hideBorder
      depth={isTouchDevice() ? 3 : 2}
      solid
    />
  );
}
