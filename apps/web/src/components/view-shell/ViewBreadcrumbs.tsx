import CaretRightIcon from '@phosphor/caret-right.svg';
import { Button, type ButtonProps, cn } from '@ui';
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
  splitProps,
  useContext,
} from 'solid-js';

type RegisteredBreadcrumb = {
  id: string;
  order: Accessor<number | undefined>;
  sequence: number;
  render: () => JSX.Element;
};

type ViewBreadcrumbsContextValue = {
  entries: Accessor<RegisteredBreadcrumb[]>;
  register: (entry: Omit<RegisteredBreadcrumb, 'sequence'>) => () => void;
};

const ViewBreadcrumbsContext = createContext<ViewBreadcrumbsContextValue>();

function useViewBreadcrumbsContext() {
  const context = useContext(ViewBreadcrumbsContext);
  if (!context) {
    throw new Error(
      'ViewBreadcrumbs registration must be inside <ViewBreadcrumbs.Provider>'
    );
  }
  return context;
}

/** Provides an ordered registration scope for breadcrumb items. */
function Provider(props: ParentProps) {
  const [entries, setEntries] = createSignal<RegisteredBreadcrumb[]>([]);
  let sequence = 0;

  const register: ViewBreadcrumbsContextValue['register'] = (entry) => {
    const registered = { ...entry, sequence: sequence++ };
    setEntries((current) => [
      ...current.filter((item) => item.id !== entry.id),
      registered,
    ]);

    return () => {
      setEntries((current) => current.filter((item) => item !== registered));
    };
  };

  return (
    <ViewBreadcrumbsContext.Provider value={{ entries, register }}>
      {props.children}
    </ViewBreadcrumbsContext.Provider>
  );
}

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

export type ViewBreadcrumbsRegisterProps = ViewBreadcrumbsItemProps & {
  id: string;
  order?: number;
};

/**
 * Registers one breadcrumb item with the nearest Provider and removes it when
 * its owning component unmounts.
 */
function Register(props: ViewBreadcrumbsRegisterProps) {
  const context = useViewBreadcrumbsContext();
  const [local, itemProps] = splitProps(props, ['id', 'order']);
  const unregister = context.register({
    id: local.id,
    order: () => local.order,
    render: () => <Item {...itemProps} />,
  });
  onCleanup(unregister);

  return null;
}

export type ViewBreadcrumbsOutletProps = ViewBreadcrumbsRootProps;

/** Renders all registered items in order with separators between them. */
function Outlet(props: ViewBreadcrumbsOutletProps) {
  const context = useViewBreadcrumbsContext();
  const entries = createMemo(() =>
    [...context.entries()].sort(
      (left, right) =>
        (left.order() ?? Number.MAX_SAFE_INTEGER) -
          (right.order() ?? Number.MAX_SAFE_INTEGER) ||
        left.sequence - right.sequence
    )
  );

  return (
    <Root {...props}>
      <For each={entries()}>
        {(entry, index) => (
          <>
            <Show when={index() > 0}>
              <Separator />
            </Show>
            {entry.render()}
          </>
        )}
      </For>
    </Root>
  );
}

export const ViewBreadcrumbs = Object.assign(Root, {
  Root,
  Item,
  Separator,
  Provider,
  Register,
  Outlet,
});
