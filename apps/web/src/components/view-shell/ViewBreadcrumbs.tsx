import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import {
  type Accessor,
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
      'ViewBreadcrumbs items must be inside <ViewBreadcrumbs.Root>'
    );
  }
  return context;
}

export type ViewBreadcrumbsRootProps = ParentProps;

/** Owns the ordered registration context for one breadcrumb path. */
function Root(props: ViewBreadcrumbsRootProps) {
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

export type ViewBreadcrumbsButtonProps =
  JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    current?: boolean;
  };

function BreadcrumbButton(props: ViewBreadcrumbsButtonProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'current',
    'type',
  ]);

  return (
    <button
      {...rest}
      type={local.type ?? 'button'}
      aria-current={local.current ? 'page' : undefined}
      class={cn(
        'flex h-7 min-w-0 items-center px-1 font-semibold text-sm tracking-[-0.03em] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none',
        local.current
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

export type ViewBreadcrumbsItemProps = ParentProps<{
  id: string;
  order?: number;
}>;

/**
 * Registers an arbitrary breadcrumb segment with the nearest Root and removes
 * it when its owning component unmounts.
 */
function Item(props: ViewBreadcrumbsItemProps) {
  const context = useViewBreadcrumbsContext();
  let unregister: (() => void) | undefined;

  onMount(() => {
    unregister = context.register({
      id: props.id,
      order: () => props.order,
      render: () => props.children,
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
