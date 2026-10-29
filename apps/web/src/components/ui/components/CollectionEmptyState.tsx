import { type ComponentProps, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type CollectionEmptyStateProps = Omit<ComponentProps<'div'>, 'children'> & {
  message: JSX.Element;
  action?: JSX.Element;
};

/**
 * Single-line empty collection row with copy and an optional trailing action.
 * @do Keep loading, errors, collection data, and edit permissions with the caller.
 * @do Pass a shared Button as the action; omit it for read-only collections.
 * @dont Use this collection placeholder as a full-page empty state.
 */
export function CollectionEmptyState(props: CollectionEmptyStateProps) {
  const [local, rest] = splitProps(props, ['message', 'action', 'class']);

  return (
    <div
      data-slot="collection-empty-state"
      class={cn(
        'flex min-h-8 w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border-secondary px-2 py-1 text-left',
        local.class
      )}
      {...rest}
    >
      <div class="min-w-0 text-xs text-ink-extra-muted">{local.message}</div>
      {local.action}
    </div>
  );
}
