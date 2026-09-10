import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface, type SurfaceProps } from './Surface';

/** Shared glass chrome. Desktop radius = 14px action radius + 8px inset. */
export function ComposerSurface(
  props: Omit<SurfaceProps, 'depth' | 'hideBorder'>
) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Surface
      {...rest}
      class={cn(
        'rounded-[22px] bg-surface touch:rounded-3xl touch:island',
        !isTouchDevice() && 'glass-input bg-menu-glass',
        isTouchDevice() && 'bg-chrome',
        local.class
      )}
      // Glass draws its own 1px rim; a Surface border would inset that rim
      // and create a second outline around the composer.
      hideBorder
      depth={isTouchDevice() ? 3 : 2}
      solid
    />
  );
}
