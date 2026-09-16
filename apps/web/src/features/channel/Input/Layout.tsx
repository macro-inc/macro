import { cn } from '@ui/utils/classname';
import { type JSX, splitProps } from 'solid-js';
import styles from './Layout.module.css';

function LayoutRoot(
  props: JSX.HTMLAttributes<HTMLDivElement> & { oneLineInput?: boolean }
) {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'oneLineInput',
  ]);

  return (
    <div
      data-input-layout
      data-one-line-input={local.oneLineInput ? '' : undefined}
      data-composer-compact={local.oneLineInput ? 'true' : 'false'}
      class={cn(styles.layout, local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
}

function Body(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      {...rest}
      data-input-body
      class={cn(styles.body, 'flex flex-col min-w-0', local.class)}
    />
  );
}

function Editor(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      {...rest}
      data-input-editor-shell
      class={cn(
        'transition-all duration-150 overflow-y-auto placeholder:text-ink-placeholder text-ink w-full text-sm',
        'p-(--input-editor-padding) not-touch:max-h-[225px]',
        local.class
      )}
    />
  );
}

function ActionsLeft(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      {...rest}
      data-input-actions-left
      class={cn(
        styles.actionsLeft,
        'flex items-center not-touch:gap-[3.75px] touch:gap-2',
        local.class
      )}
    />
  );
}

function ActionsRight(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      {...rest}
      data-input-actions-right
      class={cn(
        styles.actionsRight,
        'flex items-center not-touch:gap-[3.75px] touch:gap-2',
        local.class
      )}
    />
  );
}

export const Layout = Object.assign(LayoutRoot, {
  Body,
  Editor,
  ActionsLeft,
  ActionsRight,
});
