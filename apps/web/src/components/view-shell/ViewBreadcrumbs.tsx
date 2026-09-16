import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import {
  type Accessor,
  children,
  createContext,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  splitProps,
  useContext,
} from 'solid-js';

type RegisteredBreadcrumb = {
  value: Accessor<string>;
  order: Accessor<number | undefined>;
  sequence: number;
  render: () => JSX.Element;
};

type ViewBreadcrumbsContextValue = {
  entries: Accessor<RegisteredBreadcrumb[]>;
  value: Accessor<string>;
  onChange: (value: string) => void;
  register: (entry: Omit<RegisteredBreadcrumb, 'sequence'>) => () => void;
};

const ViewBreadcrumbsContext = createContext<ViewBreadcrumbsContextValue>();

function useViewBreadcrumbsContext() {
  const context = useContext(ViewBreadcrumbsContext);
  if (!context) {
    throw new Error(
      'ViewBreadcrumbs items must be inside <ViewBreadcrumbs.Root>'
    );
  }
  return context;
}

export type ViewBreadcrumbsRootProps = ParentProps<{
  value: string;
  onChange: (value: string) => void;
}>;

/** Owns the ordered registration context for one breadcrumb path. */
function Root(props: ViewBreadcrumbsRootProps) {
  const [entries, setEntries] = createSignal<RegisteredBreadcrumb[]>([]);
  let sequence = 0;

  const register: ViewBreadcrumbsContextValue['register'] = (entry) => {
    const registered = { ...entry, sequence: sequence++ };
    setEntries((current) => [
      ...current.filter((item) => item.value() !== entry.value()),
      registered,
    ]);

    return () => {
      setEntries((current) => current.filter((item) => item !== registered));
    };
  };

  return (
    <ViewBreadcrumbsContext.Provider
      value={{
        entries,
        value: () => props.value,
        onChange: (value) => props.onChange(value),
        register,
      }}
    >
      {props.children}
    </ViewBreadcrumbsContext.Provider>
  );
}

export type ViewBreadcrumbsItemState = {
  isActive: Accessor<boolean>;
  onSelect: () => void;
};

export type ViewBreadcrumbsButtonProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-current'
> & {
  isActive?: boolean;
};

function BreadcrumbButton(props: ViewBreadcrumbsButtonProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'isActive',
    'type',
  ]);

  return (
    <button
      {...rest}
      type={local.type ?? 'button'}
      aria-current={local.isActive ? 'page' : undefined}
      class={cn(
        'flex h-7 min-w-0 items-center px-1 font-semibold text-sm tracking-[-0.03em] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none',
        local.isActive
          ? 'shrink text-ink'
          : 'text-ink-muted hover:text-ink focus-visible:text-ink',
        local.class
      )}
    >
      {local.children}
    </button>
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

export type ViewBreadcrumbsItemProps = {
  value: string;
  order?: number;
  children: JSX.Element | ((state: ViewBreadcrumbsItemState) => JSX.Element);
};

/**
 * Registers an arbitrary breadcrumb segment with the nearest Root and removes
 * it when its owning component unmounts.
 */
function Item(props: ViewBreadcrumbsItemProps) {
  const context = useViewBreadcrumbsContext();
  const state: ViewBreadcrumbsItemState = {
    isActive: () => context.value() === props.value,
    onSelect: () => context.onChange(props.value),
  };
  const resolvedChildren = children(() => {
    const child = props.children;
    return <>{typeof child === 'function' ? child(state) : child}</>;
  });
  let unregister: (() => void) | undefined;

  onMount(() => {
    unregister = context.register({
      value: () => props.value,
      order: () => props.order,
      render: resolvedChildren,
    });
  });
  onCleanup(() => unregister?.());

  return null;
}

export type ViewBreadcrumbsOutletProps = JSX.HTMLAttributes<HTMLElement>;

/** Renders all registered items in order with separators between them. */
function Outlet(props: ViewBreadcrumbsOutletProps) {
  const context = useViewBreadcrumbsContext();
  const [local, rest] = splitProps(props, ['children', 'class']);
  const entries = createMemo(() =>
    [...context.entries()].sort(
      (left, right) =>
        (left.order() ?? Number.MAX_SAFE_INTEGER) -
          (right.order() ?? Number.MAX_SAFE_INTEGER) ||
        left.sequence - right.sequence
    )
  );

  return (
    <nav
      aria-label="Breadcrumb"
      {...rest}
      class={cn('flex min-w-0 items-center gap-0.5 text-sm', local.class)}
    >
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
      {local.children}
    </nav>
  );
}

export const ViewBreadcrumbs = Object.assign(Root, {
  Root,
  Button: BreadcrumbButton,
  Item,
  Separator,
  Outlet,
});
