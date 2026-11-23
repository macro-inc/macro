import { cn } from '@ui';
import type { ParentProps } from 'solid-js';
import { Layout } from '../../core/Layout';
import { SOUP_ROW_CLASS } from './row-geometry';

/** Shared Soup row tracks keep phone tasks and projects on the same 44px grid. */
export function NarrowRowGrid(
  props: ParentProps<{ variant: 'compact' | 'standard' | 'expanded' }>
) {
  const compact = () => props.variant === 'compact';
  const expanded = () => props.variant === 'expanded';
  return (
    <Layout
      class={cn(
        SOUP_ROW_CLASS.narrow,
        'w-full items-center text-sm pr-2 grid',
        compact()
          ? 'gap-x-0 pl-0'
          : 'gap-x-(--soup-row-column-gap) pl-(--soup-row-padding-l)'
      )}
      style={{
        'grid-template-columns': compact()
          ? '0.5rem minmax(0, 1fr) max-content'
          : 'var(--soup-row-indicator-width) 1fr max-content',
        'grid-template-rows': expanded() ? '44px auto' : '44px',
        'grid-template-areas': expanded()
          ? '"indicator title timestamp" ". body body"'
          : '"indicator title timestamp"',
      }}
    >
      {props.children}
    </Layout>
  );
}
