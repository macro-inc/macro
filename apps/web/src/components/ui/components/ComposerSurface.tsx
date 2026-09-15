import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import styles from './chat-composer.module.css';
import { Surface, type SurfaceProps } from './Surface';

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
      class={cn(
        'rounded-[22px] bg-surface touch:rounded-3xl touch:island',
        !isTouchDevice() && 'glass-input bg-menu-glass',
        isTouchDevice() && 'bg-chrome',
        !isTouchDevice() && local.appearance === 'chat' && styles.chat,
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
