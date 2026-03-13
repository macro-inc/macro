import { cn } from '@ui/utils/classname';
import { splitProps, type JSX } from 'solid-js';

function ActionsRoot(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn(
        'flex flex-row w-full justify-between items-center',
        local.class
      )}
      data-input-actions
      {...rest}
    >
      {local.children}
    </div>
  );
}

function ActionsLeft(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('flex flex-row items-center gap-2', local.class)}
      data-input-actions-left
      {...rest}
    >
      {local.children}
    </div>
  );
}

function ActionsRight(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('flex flex-row items-center gap-2', local.class)}
      data-input-actions-right
      {...rest}
    >
      {local.children}
    </div>
  );
}

export const Actions = Object.assign(ActionsRoot, {
  Left: ActionsLeft,
  Right: ActionsRight,
});
