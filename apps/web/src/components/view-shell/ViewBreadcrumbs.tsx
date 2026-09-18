import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn, Dropdown, Tooltip } from '@ui';
import {
  type Accessor,
  children,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { createStore, produce, type Store } from 'solid-js/store';

export type ViewBreadcrumbsEntry<TMetadata> = {
  value: Accessor<string>;
  label: Accessor<string>;
  metadata: Accessor<TMetadata>;
  order: Accessor<number | undefined>;
  sequence: number;
  render: () => JSX.Element;
};

type ViewBreadcrumbsContextValue = {
  entries: Store<ViewBreadcrumbsEntry<unknown>[]>;
  value: Accessor<string>;
  onChange: (value: string) => void;
  register: (
    entry: Omit<ViewBreadcrumbsEntry<unknown>, 'sequence'>
  ) => () => void;
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

/** Owns mounted breadcrumb item registrations. */
function Root(props: ViewBreadcrumbsRootProps) {
  const [entries, setEntries] = createStore<ViewBreadcrumbsEntry<unknown>[]>(
    []
  );
  let sequence = 0;

  const register: ViewBreadcrumbsContextValue['register'] = (entry) => {
    const registered = { ...entry, sequence: sequence++ };
    setEntries(
      produce((draft) => {
        const previous = draft.findIndex(
          (item) => item.value() === entry.value()
        );
        if (previous >= 0) draft.splice(previous, 1);
        draft.push(registered);
      })
    );

    return () => {
      setEntries(
        produce((draft) => {
          const index = draft.findIndex(
            (item) => item.sequence === registered.sequence
          );
          if (index >= 0) draft.splice(index, 1);
        })
      );
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
  tooltip?: string;
};

function BreadcrumbButton(props: ViewBreadcrumbsButtonProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'isActive',
    'tooltip',
    'type',
  ]);

  const button = () => (
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

  return (
    <Show when={local.tooltip} fallback={button()}>
      {(tooltip) => (
        <Tooltip class="min-w-0" label={tooltip()}>
          {button()}
        </Tooltip>
      )}
    </Show>
  );
}

export type ViewBreadcrumbsSeparatorProps = JSX.SvgSVGAttributes<SVGSVGElement>;

function ReturnButton(props: ViewBreadcrumbsButtonProps) {
  const [local, rest] = splitProps(props, ['children', 'class']);

  return (
    <BreadcrumbButton {...rest} class={cn('shrink-0', local.class)}>
      {local.children}
    </BreadcrumbButton>
  );
}

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

export type ViewBreadcrumbsItemProps<TMetadata = unknown> = {
  value: string;
  label: string;
  metadata: TMetadata;
  order?: number;
  children: JSX.Element | ((state: ViewBreadcrumbsItemState) => JSX.Element);
};

/** Registers a breadcrumb item and removes it with its owning component. */
function Item<TMetadata = unknown>(props: ViewBreadcrumbsItemProps<TMetadata>) {
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
      label: () => props.label,
      metadata: () => props.metadata,
      order: () => props.order,
      render: resolvedChildren,
    });
  });
  onCleanup(() => unregister?.());

  return null;
}

export type ViewBreadcrumbsOutletProps = Omit<
  JSX.HTMLAttributes<HTMLElement>,
  'children'
> & {
  children?: JSX.Element;
  fallback?: JSX.Element;
  separator?: (state: ViewBreadcrumbsSeparatorState) => JSX.Element;
};

export type ViewBreadcrumbsSeparatorState = {
  previous: ViewBreadcrumbsEntry<unknown>;
  next?: ViewBreadcrumbsEntry<unknown>;
};

const OVERFLOW_EPSILON_PX = 2;

function BreadcrumbOverflowMenu(props: {
  entries: ViewBreadcrumbsEntry<unknown>[];
  onSelect: (value: string) => void;
}) {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        class="h-7 min-w-0 shrink-0 px-1 font-semibold text-ink-muted"
        aria-label={`Show ${props.entries.length} hidden breadcrumbs`}
      >
        <span aria-hidden="true">{props.entries.length} more</span>
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={props.entries}>
            {(entry) => (
              <Dropdown.Item
                class="max-w-72"
                onSelect={() => props.onSelect(entry.value())}
              >
                <span class="truncate">{entry.label()}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** Renders mounted breadcrumb items in order. */
function Outlet(props: ViewBreadcrumbsOutletProps) {
  const context = useViewBreadcrumbsContext();
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'fallback',
    'separator',
  ]);
  const entries = createMemo(() =>
    [...context.entries].sort(
      (left, right) =>
        (left.order() ?? Number.MAX_SAFE_INTEGER) -
          (right.order() ?? Number.MAX_SAFE_INTEGER) ||
        left.sequence - right.sequence
    )
  );
  const hasActiveItem = () =>
    entries().some((entry) => entry.value() === context.value());
  const hasFallback = () => !hasActiveItem() && local.fallback != null;
  const middleEntries = createMemo(() =>
    entries().filter(
      (_entry, index, all) =>
        index > 0 && (hasFallback() || index < all.length - 1)
    )
  );
  const [collapsed, setCollapsed] = createSignal(false);
  let viewport: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  let measureQueued = false;
  let expandedWidth = 0;

  const measure = () => {
    measureQueued = false;
    if (!viewport || !content) return;
    if (middleEntries().length === 0) {
      setCollapsed(false);
      expandedWidth = content.scrollWidth;
      return;
    }

    const availableWidth = viewport.clientWidth;
    if (!collapsed()) {
      expandedWidth = content.scrollWidth;
      if (expandedWidth - availableWidth > OVERFLOW_EPSILON_PX) {
        setCollapsed(true);
      }
      return;
    }

    if (
      expandedWidth > 0 &&
      expandedWidth - availableWidth > OVERFLOW_EPSILON_PX
    ) {
      return;
    }

    // Trial the expanded row synchronously, then restore the collapsed row
    // before paint if it still does not fit.
    setCollapsed(false);
    expandedWidth = content.scrollWidth;
    if (expandedWidth - availableWidth > OVERFLOW_EPSILON_PX) {
      setCollapsed(true);
    }
  };
  const scheduleMeasure = () => {
    if (measureQueued) return;
    measureQueued = true;
    queueMicrotask(measure);
  };

  createEffect(
    on(
      () =>
        JSON.stringify([
          hasFallback(),
          entries().map((entry) => [
            entry.sequence,
            entry.value(),
            entry.label(),
            entry.order(),
          ]),
        ]),
      () => {
        expandedWidth = 0;
        scheduleMeasure();
      }
    )
  );

  onMount(() => {
    const observer = new ResizeObserver(scheduleMeasure);
    if (viewport) observer.observe(viewport, { box: 'border-box' });
    if (content) observer.observe(content, { box: 'border-box' });
    scheduleMeasure();
    onCleanup(() => observer.disconnect());
  });

  const renderSeparator = (
    previous: ViewBreadcrumbsEntry<unknown>,
    next?: ViewBreadcrumbsEntry<unknown>
  ) => local.separator?.({ previous, next }) ?? <Separator />;

  return (
    <nav
      aria-label="Breadcrumb"
      {...rest}
      class={cn('flex min-w-0 flex-1 items-center text-sm', local.class)}
    >
      <div
        ref={viewport}
        data-view-breadcrumbs-viewport=""
        class="min-w-0 max-w-full flex-1 overflow-hidden"
      >
        <div
          ref={content}
          data-view-breadcrumbs-content=""
          data-collapsed={collapsed() ? '' : undefined}
          class={cn(
            'flex min-w-0 items-center gap-0.5',
            collapsed() ? 'w-full' : 'w-max'
          )}
        >
          <For each={entries()}>
            {(entry, index) => {
              const isMiddle = () =>
                index() > 0 &&
                (hasFallback() || index() < entries().length - 1);
              return (
                <>
                  <Show when={collapsed() && index() === 1}>
                    <span class="flex shrink-0 items-center gap-0.5">
                      {renderSeparator(entries()[0]!, entry)}
                      <BreadcrumbOverflowMenu
                        entries={middleEntries()}
                        onSelect={context.onChange}
                      />
                    </span>
                  </Show>
                  <span
                    data-view-breadcrumbs-segment={entry.value()}
                    class={cn(
                      'flex min-w-0 items-center gap-0.5',
                      index() === 0 && 'shrink-0 [&_button]:max-w-none',
                      collapsed() && isMiddle() && 'hidden'
                    )}
                  >
                    <Show when={index() > 0}>
                      {renderSeparator(entries()[index() - 1]!, entry)}
                    </Show>
                    {entry.render()}
                  </span>
                </>
              );
            }}
          </For>
          <Show when={hasFallback()}>
            <Show when={entries().at(-1)}>
              {(entry) => renderSeparator(entry())}
            </Show>
            {local.fallback}
          </Show>
          {local.children}
        </div>
      </div>
    </nav>
  );
}

export const ViewBreadcrumbs = Object.assign(Root, {
  Root,
  Button: BreadcrumbButton,
  ReturnButton,
  Item,
  Separator,
  Outlet,
});
