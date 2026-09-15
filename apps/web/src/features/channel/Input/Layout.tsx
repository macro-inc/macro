import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import { Actions } from './Actions';
import { EditorShell } from './EditorShell';

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
      class={cn(
        'group/input-layout grid grid-cols-[auto_minmax(0,1fr)_auto] items-center w-full not-touch:p-[7.5px]',
        local.oneLineInput &&
          'items-end gap-[3.75px] min-h-[48.75px] p-[7.5px]',
        local.class
      )}
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
      class={cn(
        'flex flex-col min-w-0 row-start-1 col-span-full group-data-[one-line-input]/input-layout:col-start-2 group-data-[one-line-input]/input-layout:col-end-auto',
        local.class
      )}
    />
  );
}

function Editor(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <EditorShell
      {...rest}
      class={cn(
        'group-data-[one-line-input]/input-layout:px-[3.75px] group-data-[one-line-input]/input-layout:py-[4.6875px]',
        local.class
      )}
    />
  );
}

function ActionsLeft(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <Actions.Left
      {...rest}
      class={cn(
        'col-start-1 row-start-2 pl-2 pb-2 touch:h-8 touch:py-2 touch:mb-2 not-touch:pl-0 not-touch:pb-0 not-touch:pt-[3.75px]',
        'group-data-[one-line-input]/input-layout:row-start-1 group-data-[one-line-input]/input-layout:p-0 group-data-[one-line-input]/input-layout:h-auto group-data-[one-line-input]/input-layout:mb-0',
        local.class
      )}
    />
  );
}

function ActionsRight(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <Actions.Right
      {...rest}
      class={cn(
        'col-start-3 row-start-2 pr-2 pb-2 touch:h-8 touch:py-2 touch:mb-2 not-touch:pr-0 not-touch:pb-0 not-touch:pt-[3.75px]',
        'group-data-[one-line-input]/input-layout:row-start-1 group-data-[one-line-input]/input-layout:p-0 group-data-[one-line-input]/input-layout:h-auto group-data-[one-line-input]/input-layout:mb-0',
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
