import { type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Item } from './Item';
import { Layer } from './Layer';

export type CardProps = ComponentProps<'div'> & {
  depth?: 0 | 1 | 2 | 3 | 4;
  offset?: number;
  variant?: 'ghost' | 'outlined' | 'filled';
};

function CardRoot(props: CardProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'depth',
    'offset',
    'variant',
    'children',
  ]);
  const variant = () => local.variant ?? 'outlined';
  return (
    <Layer depth={local.depth} offset={local.offset}>
      <div
        data-slot="card"
        data-variant={variant()}
        class={cn(
          'relative flex min-w-0 flex-col rounded-xl border border-transparent text-ink',
          variant() === 'outlined' && 'border-edge-muted',
          variant() === 'filled' ? 'border-edge bg-surface' : 'bg-transparent',
          local.class
        )}
        {...rest}
      >
        {local.children}
      </div>
    </Layer>
  );
}

function CardHeader(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-header"
      class={cn('flex min-w-0 flex-col gap-1 p-3', local.class)}
      {...rest}
    />
  );
}

function CardBody(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-body"
      class={cn('min-w-0 p-3 text-sm leading-6', local.class)}
      {...rest}
    />
  );
}

function CardMedia(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-media"
      class={cn(
        'relative min-w-0 overflow-hidden bg-hover first:rounded-t-[inherit] last:rounded-b-[inherit] [&>img]:w-full [&>img]:object-cover',
        local.class
      )}
      {...rest}
    />
  );
}

function CardFooter(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-footer"
      class={cn(
        'flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-edge-muted p-3',
        local.class
      )}
      {...rest}
    />
  );
}

/** An intrinsic-height frame for rich content, composed with Item identity rows.
 * @do Compose Header, Media, Body, and Footer in the order the content needs.
 * @do Use Item inside Header; Card shares Item's Title, Description, Metadata, and Actions.
 * @do Give media an explicit height or aspect ratio at the call site.
 * @do Keep loading, selection, navigation, and data fetching with the feature.
 * @do Use ghost for no frame, outlined (default) for a muted edge, and filled for bg-surface with border-edge.
 * @do Set depth to choose a Layer surface depth; omit it to inherit the parent layer.
 * @do Use offset={1} to sit one depth above the parent; Layer clamps depths to 0–4.
 * @dont Wrap a card with nested actions in a button or link. Link its title instead.
 * @dont Add empty slots for spacing; omitted slots take no space.
 */
export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Media: CardMedia,
  Body: CardBody,
  Footer: CardFooter,
  Title: Item.Title,
  Icon: Item.Icon,
  Description: Item.Description,
  Metadata: Item.Metadata,
  Actions: Item.Actions,
});
