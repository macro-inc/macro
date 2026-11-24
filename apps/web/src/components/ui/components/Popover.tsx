import * as KobaltePopover from '@kobalte/core/popover';
import { type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';
import { Menu } from './Menu';
import type { SurfaceProps } from './Surface';

export type PopoverContentProps = ComponentProps<
  typeof KobaltePopover.Content
> & {
  depth?: SurfaceProps['depth'];
};

function PopoverContent(props: PopoverContentProps) {
  const [local, rest] = splitProps(props, ['class', 'depth']);
  return (
    <KobaltePopover.Content
      as={Menu.Surface}
      depth={local.depth ?? 2}
      {...rest}
      class={cn(
        'max-h-[var(--kb-popper-content-available-height)]',
        local.class
      )}
    />
  );
}

function PopoverTrigger(
  props: ButtonProps & ComponentProps<typeof KobaltePopover.Trigger>
) {
  return (
    <KobaltePopover.Trigger as={Button} variant="ghost" size="sm" {...props} />
  );
}

function PopoverOverlay(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      aria-hidden="true"
      {...rest}
      class={cn('fixed inset-0 z-action-menu bg-overlay', local.class)}
    />
  );
}

/**
 * Dialog semantics with the same surface material as Dropdown.
 * @do Use Menu groups and items for selectable rows inside a popover.
 * @do Keep only placement and width constraints on content callers.
 * @dont Override the shared fill, border, shadow, or corner radius.
 */
export const Popover = Object.assign(KobaltePopover.Root, {
  Root: KobaltePopover.Root,
  Anchor: KobaltePopover.Anchor,
  Trigger: PopoverTrigger,
  Portal: KobaltePopover.Portal,
  Content: PopoverContent,
  Overlay: PopoverOverlay,
  Title: KobaltePopover.Title,
  Description: KobaltePopover.Description,
  CloseButton: KobaltePopover.CloseButton,
});
