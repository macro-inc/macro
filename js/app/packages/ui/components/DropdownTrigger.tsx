import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { type ComponentProps, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type DropdownTriggerProps = ComponentProps<typeof DropdownMenu.Trigger> & {
  children?: JSX.Element;
  class?: string;
};

/**
 * Standardized trigger for `DropdownMenu` menus.
 *
 * Renders a `DropdownMenu.Trigger` styled as a 28px-tall pill with an
 * `edge-muted` border, matching the design used for filter/sort buttons.
 *
 * Must be used inside a `<DropdownMenu>` from `@kobalte/core/dropdown-menu`.
 */
export const DropdownTrigger = (props: DropdownTriggerProps) => {
  const [local, others] = splitProps(props, ['class', 'children']);

  return (
    <DropdownMenu.Trigger
      class={cn(
        'bg-transparent [&_svg]:size-4 outline-none text-ink text-xs font-medium leading-none whitespace-nowrap', /* Color & typography */
        'relative inline-flex items-center justify-center gap-1 h-7 px-2',                                        /* Layout: 28px tall, padded, flex row with small gap */
        'not-disabled:hover:bg-ink/10 not-disabled:active:bg-ink/12',                                             /* Enabled State */
        'disabled:opacity-30 disabled:cursor-not-allowed',                                                        /* Disabled State */
        'rounded-xs border border-edge-muted',                                                                    /* Shape & border (uniform edge-muted border) */
        local.class
      )}
      {...others}
    >
      {local.children}
    </DropdownMenu.Trigger>
  );
};
