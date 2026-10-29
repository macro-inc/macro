import { type ComponentProps, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type CollectionEmptyStateProps = Omit<ComponentProps<'div'>, 'children'> & {
  message: JSX.Element;
  action?: JSX.Element;
};

/**
 * Compact bordered empty collection message with an optional outside action.
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
        'flex min-h-9 w-full items-center gap-2 text-left',
        local.class
      )}
      {...rest}
    >
      <div class="flex min-h-9 min-w-0 flex-1 items-center rounded-lg border border-dashed border-border-secondary px-2 py-1 text-xs text-ink-extra-muted">
        {local.message}
      </div>
      {local.action}
    </div>
  );
}
