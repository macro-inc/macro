import { cn } from '@ui/utils/classname';
import { type JSX, splitProps } from 'solid-js';

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
        'grid grid-cols-[auto_minmax(0,1fr)_auto] w-full',
        local.oneLineInput
          ? "[grid-template-areas:'left_body_right'] items-end gap-[3.75px] min-h-[48.75px] p-[7.5px] [--input-editor-padding:4.6875px_3.75px]"
          : [
              "[grid-template-areas:'body_body_body'_'left_._right'] items-center",
              'not-touch:gap-y-[3.75px] not-touch:p-[7.5px] not-touch:[--input-editor-padding:4.6875px_9.375px]',
              'touch:pb-2 touch:[--input-editor-padding:0.5rem_0.75rem] touch:@[40rem]:[--input-editor-padding:0.5rem_0.75rem_1rem]',
              'touch:[&>[data-input-actions-left]]:h-8 touch:[&>[data-input-actions-left]]:pl-2',
              'touch:[&>[data-input-actions-right]]:h-8 touch:[&>[data-input-actions-right]]:pr-2',
            ],
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
      class={cn('[grid-area:body] flex flex-col min-w-0', local.class)}
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
        '[grid-area:left] flex items-center not-touch:gap-[3.75px] touch:gap-2',
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
        '[grid-area:right] flex items-center not-touch:gap-[3.75px] touch:gap-2',
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
