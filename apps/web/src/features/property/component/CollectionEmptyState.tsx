import { cn } from '@ui/utils/classname';
import { type ComponentProps, type JSX, splitProps } from 'solid-js';

export type CollectionEmptyStateProps = Omit<
  ComponentProps<'div'>,
  'children'
> & {
  message: JSX.Element;
  action?: JSX.Element;
};

export function CollectionEmptyState(props: CollectionEmptyStateProps) {
  const [local, rest] = splitProps(props, ['message', 'action', 'class']);

  return (
    <div
      data-slot="collection-empty-state"
      class={cn(
        'flex w-full min-w-0 flex-col items-start gap-2 text-left',
        local.class
      )}
      {...rest}
    >
      <span class="text-xs text-ink-extra-muted">{local.message}</span>
      {local.action}
    </div>
  );
}
