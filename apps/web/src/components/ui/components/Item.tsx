import { type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

export type ItemProps = ComponentProps<'div'> & {
  size?: 'sm' | 'md';
  depth?: 0 | 1 | 2 | 3 | 4;
  offset?: number;
  variant?: 'ghost' | 'outlined' | 'filled';
};

function ItemRoot(props: ItemProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'size',
    'depth',
    'offset',
    'variant',
    'children',
  ]);
  const variant = () => local.variant ?? 'ghost';
  return (
    <Layer depth={local.depth} offset={local.offset}>
      <div
        data-slot="item"
        data-variant={variant()}
        class={cn(
          'flex min-w-0 items-center gap-3 rounded-xl border border-transparent text-sm text-ink',
          variant() === 'outlined' && 'border-edge-muted',
          variant() === 'filled' ? 'border-edge bg-surface' : 'bg-transparent',
          local.size === 'sm' ? 'p-2' : 'p-3',
          local.class
        )}
        {...rest}
      >
        {local.children}
      </div>
    </Layer>
  );
}

function ItemIcon(props: ComponentProps<'span'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <span
      data-slot="item-icon"
      class={cn(
        'inline-flex h-5 w-4 shrink-0 self-start items-center justify-center [&>svg]:size-4',
        local.class
      )}
      {...rest}
    />
  );
}

function ItemMedia(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-media"
      class={cn(
        'flex size-10 shrink-0 self-start items-center justify-center overflow-hidden rounded-lg bg-hover text-ink-muted [&>svg]:size-5 [&>img]:size-full [&>img]:object-cover',
        local.class
      )}
      {...rest}
    />
  );
}

function ItemContent(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-content"
      class={cn('flex min-w-0 flex-1 flex-col gap-1', local.class)}
      {...rest}
    />
  );
}

function ItemTitle(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-title"
      class={cn(
        'min-w-0 text-sm font-semibold leading-5 wrap-break-word',
        local.class
      )}
      {...rest}
    />
  );
}

function ItemDescription(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-description"
      class={cn(
        'text-sm font-normal leading-5 text-ink-muted wrap-break-word',
        local.class
      )}
      {...rest}
    />
  );
}

function ItemMetadata(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-metadata"
      class={cn(
        'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium leading-4 text-ink-subtle',
        local.class
      )}
      {...rest}
    />
  );
}

function ItemActions(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-actions"
      class={cn('flex shrink-0 items-center gap-1', local.class)}
      {...rest}
    />
  );
}

/** A content row shared by lists and rich cards.
 * @do Compose Media, Content, and Actions in reading order; all slots are optional.
 * @do Use Icon for a plain 1rem icon aligned with the first title line; Media is a larger top-aligned tile. Use self-center to opt into centered media.
 * @do Use Title, Description, and Metadata inside Content for a consistent hierarchy.
 * @do Put native links or Buttons inside slots for keyboard-accessible actions.
 * @do Use size="sm" for compact rows, and class="p-0" inside a padded Card slot.
 * @do Use ghost (default) for no frame, outlined for a muted edge, and filled for bg-surface with border-edge.
 * @do Set depth to choose a Layer surface depth; omit it to inherit the parent layer.
 * @do Use offset={1} to sit one depth above the parent; Layer clamps depths to 0–4.
 * @dont Turn the root into a click target containing other interactive controls.
 * @dont Truncate labels without a Tooltip; titles wrap by default.
 */
export const Item = Object.assign(ItemRoot, {
  Icon: ItemIcon,
  Media: ItemMedia,
  Content: ItemContent,
  Title: ItemTitle,
  Description: ItemDescription,
  Metadata: ItemMetadata,
  Actions: ItemActions,
});
