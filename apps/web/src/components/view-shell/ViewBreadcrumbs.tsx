import CaretRightIcon from '@phosphor/caret-right.svg';
import { Button, type ButtonProps, cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';

export type ViewBreadcrumbsRootProps = JSX.HTMLAttributes<HTMLElement>;

function Root(props: ViewBreadcrumbsRootProps) {
  const [local, rest] = splitProps(props, ['children', 'class']);

  return (
    <nav
      aria-label="Breadcrumb"
      {...rest}
      class={cn('flex min-w-0 items-center gap-0.5 text-sm', local.class)}
    >
      {local.children}
    </nav>
  );
}

export type ViewBreadcrumbsItemProps = ButtonProps & {
  current?: boolean;
};

function Item(props: ViewBreadcrumbsItemProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'current',
    'depth',
    'size',
    'variant',
  ]);

  return (
    <Button
      {...rest}
      aria-current={local.current ? 'page' : undefined}
      variant={local.variant ?? 'ghost'}
      size={local.size ?? 'sm'}
      depth={local.depth ?? 2}
      class={cn(
        'h-7 min-w-0 px-1 text-sm',
        local.current
          ? 'shrink font-semibold text-ink'
          : 'font-normal text-ink-muted',
        local.class
      )}
    >
      {local.children}
    </Button>
  );
}

export type ViewBreadcrumbsSeparatorProps = JSX.SvgSVGAttributes<SVGSVGElement>;

function Separator(props: ViewBreadcrumbsSeparatorProps) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <CaretRightIcon
      {...rest}
      aria-hidden="true"
      class={cn('size-3 shrink-0 text-ink-extra-muted', local.class)}
    />
  );
}

export const ViewBreadcrumbs = Object.assign(Root, {
  Root,
  Item,
  Separator,
});
