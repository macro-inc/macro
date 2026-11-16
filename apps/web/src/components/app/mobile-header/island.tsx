import { cn, Layer } from '@ui';
import { type ComponentProps, splitProps } from 'solid-js';

/**
 * A floating pill in the touch header, on the same Layer depth as the rest of
 * the floating chrome (dock, accessories) so `island` surface colors match.
 * The touch header ignores taps outside islands.
 */
export function MobileHeaderIsland(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <Layer depth={3}>
      <div
        {...rest}
        data-header-island
        class={cn(
          'island pointer-events-auto flex h-10 min-w-0 shrink-0 items-center gap-1 rounded-full px-3 empty:hidden',
          local.class
        )}
      >
        {local.children}
      </div>
    </Layer>
  );
}
