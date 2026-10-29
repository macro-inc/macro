import { type ComponentProps, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type CollectionEmptyStateProps = Omit<ComponentProps<'div'>, 'children'> & {
  message: JSX.Element;
  action?: JSX.Element;
};

/**
 * Compact empty collection frame with centered copy and an optional action.
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
        'flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dotted border-border-secondary p-4 text-center',
        local.class
      )}
      {...rest}
    >
      <div class="max-w-full text-xs text-ink-extra-muted">{local.message}</div>
      {local.action}
    </div>
  );
}
