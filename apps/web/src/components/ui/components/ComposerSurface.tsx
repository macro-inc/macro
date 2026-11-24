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
        // Light mode keeps the composer's wide halo: a fine outline alone
        // vanishes against near-white content.
        !isTouchDevice() &&
          'rounded-[28px] border-0 bg-composer text-composer-ink glass-input light-mode:composer-shadow',
        local.class
      )}
    />
  );
}
