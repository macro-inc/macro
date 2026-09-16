import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Surface, type SurfaceProps } from './Surface';

type ComposerPanelProps = Omit<SurfaceProps, 'depth' | 'hideBorder'>;

function ComposerPanel(props: ComposerPanelProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Surface
      {...rest}
      class={cn('touch:rounded-3xl touch:island touch:bg-chrome', local.class)}
      // Glass draws its own 1px rim; a Surface border would inset that rim
      // and create a second outline around the composer.
      hideBorder
      depth={isTouchDevice() ? 3 : 2}
      solid
    />
  );
}

/**
 * Shared composer chrome. Use `as="div"` to style an existing card or layout
 * root without adding Surface sizing, clipping, depth, or touch styling.
 */
export function ComposerSurface(
  props: ComposerPanelProps & {
    as?: 'div';
  }
) {
  const [local, rest] = splitProps(props, ['as', 'class']);
  return (
    <Dynamic
      component={local.as ?? ComposerPanel}
      {...rest}
      class={cn(
        !isTouchDevice() &&
          'rounded-[26.25px] border-0 bg-composer text-composer-ink dark-mode:glass-input backdrop-filter-none light-mode:after:hidden light-mode:shadow-[0_0_0_0.9375px_var(--color-drop-shadow),0_1.875px_7.5px_0_var(--color-drop-shadow),0_3.75px_75px_7.5px_color-mix(in_srgb,var(--color-drop-shadow)_60%,transparent)]',
        local.class
      )}
    />
  );
}
