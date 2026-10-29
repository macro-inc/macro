import { cn } from '@ui/utils/classname';
import { type ComponentProps, type JSX, splitProps } from 'solid-js';

export type CollectionEmptyStateProps = Omit<ComponentProps<'div'>, 'children'> & {
  message: JSX.Element;
  action?: JSX.Element;
};

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
      <div class="flex min-h-9 min-w-0 flex-1 items-center px-2 py-1 text-xs text-ink-extra-muted">
        {local.message}
      </div>
      {local.action}
    </div>
  );
}
