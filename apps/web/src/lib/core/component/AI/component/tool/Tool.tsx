import { DisclosureCaret } from '@app/features/block-agent/ui/DisclosureCaret';
import CaretRight from '@icon/system/regular/caret-right.svg?component-solid';
import { Button, Layer } from '@ui';
import type { Accessor, Component, JSX } from 'solid-js';
import { createContext, Show, useContext } from 'solid-js';

type ToolRowProps = {
  /** The call is still running: its text shimmers, as an active agent row does. */
  active?: boolean;
  align?: 'center' | 'start';
  children: JSX.Element;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  trailing?: JSX.Element;
};

type ToolRootProps = {
  children: JSX.Element;
  grouped?: boolean;
  muted?: boolean;
};

type ToolGroupProps = {
  children: JSX.Element;
};

type ToolResponseProps = {
  children: JSX.Element;
};

type ToolResultToggleProps = {
  expanded: boolean;
  onToggle: (event: MouseEvent) => void;
  showToggle?: boolean;
  status?: JSX.Element;
};

type ToolListProps = {
  children: JSX.Element;
};

type ToolListItemProps = {
  children: JSX.Element;
  icon?: JSX.Element;
};

type ToolListButtonProps = {
  children: JSX.Element;
  onClick?: (event: MouseEvent) => void;
};

/**
 * A grouped tool sits among an agent's other tool rows, so it drops its card,
 * icons, and indents to read as one more line of that list.
 */
const GroupedContext = createContext<Accessor<boolean>>(() => false);

function Root(props: ToolRootProps) {
  const content = () => (
    <GroupedContext.Provider value={() => props.grouped ?? false}>
      <div
        class="relative overflow-hidden text-xs leading-5 text-ink-extra-muted"
        classList={{
          'opacity-50': props.muted,
          'rounded-lg bg-surface': !props.grouped,
        }}
      >
        {props.children}
      </div>
    </GroupedContext.Provider>
  );

  return (
    <Show when={!props.grouped} fallback={content()}>
      <Layer depth={0}>{content()}</Layer>
    </Show>
  );
}

function Row(props: ToolRowProps) {
  const grouped = useContext(GroupedContext);
  const alignStart = () => props.align === 'start';

  return (
    <div
      class="flex w-full"
      classList={{
        'relative min-h-8 gap-1.5 py-1 text-sm leading-6 not-touch:has-[[aria-expanded]]:hover:text-ink-muted':
          grouped(),
        'min-h-9 gap-2 px-3 py-2': !grouped(),
        'items-center': !alignStart(),
        'items-start': alignStart(),
      }}
    >
      <Show when={!grouped()}>
        <props.icon
          class="size-4 shrink-0 text-ink-extra-muted"
          classList={{ 'mt-0.5': alignStart() }}
        />
      </Show>
      {/* Grouped, the content takes only its text's width, so a count the
          renderer spaces to the far edge follows the detail at the row's gap
          instead, and the object a renderer highlights steps down to the
          detail's tone. */}
      <div
        class="min-w-0 overflow-hidden"
        classList={{
          'flex-1': !grouped(),
          '*:gap-1.5 [--color-ink:var(--color-ink-disabled)]': grouped(),
          'magic-chip-shimmer': props.active,
        }}
      >
        {props.children}
      </div>
      <Show when={props.trailing}>
        <div class="shrink-0 whitespace-nowrap">{props.trailing}</div>
      </Show>
    </div>
  );
}

function Response(props: ToolResponseProps) {
  const grouped = useContext(GroupedContext);
  return (
    <div class="pb-2" classList={{ 'px-3': !grouped() }}>
      {props.children}
    </div>
  );
}

function ResultToggle(props: ToolResultToggleProps) {
  const grouped = useContext(GroupedContext);
  const canToggle = () => props.showToggle ?? true;
  const toggle = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onToggle(event);
  };

  return (
    <Show
      when={canToggle()}
      fallback={
        <Show when={props.status}>
          <span
            class="shrink-0 whitespace-nowrap"
            classList={{
              'text-ink-disabled': grouped(),
              'text-xs text-ink-extra-muted': !grouped(),
            }}
          >
            {props.status}
          </span>
        </Show>
      }
    >
      <Show
        when={grouped()}
        fallback={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={props.expanded}
            class="shrink-0 whitespace-nowrap px-1 text-ink-extra-muted hover:text-ink-muted"
            onClick={toggle}
          >
            <Show when={props.status}>
              <span>{props.status}</span>
            </Show>
            <CaretRight
              class="size-3 touch:size-6 shrink-0 pointer-events-none"
              aria-hidden="true"
              classList={{
                'rotate-90': props.expanded,
              }}
            />
          </Button>
        }
      >
        {/* Stretched over the row, so the whole row opens the results as the
            session's other tool rows do. */}
        <button
          type="button"
          aria-expanded={props.expanded}
          class="group flex shrink-0 items-center gap-1.5 whitespace-nowrap outline-none after:absolute after:inset-0 after:outline-offset-2 focus-visible:after:outline-2 focus-visible:after:outline-accent"
          onClick={toggle}
        >
          <Show when={props.status}>
            <span class="tabular-nums text-ink-disabled">{props.status}</span>
          </Show>
          <DisclosureCaret open={props.expanded} />
        </button>
      </Show>
    </Show>
  );
}

function Group(props: ToolGroupProps) {
  return (
    <Layer depth={0}>
      <div class="overflow-hidden rounded-lg border border-edge-muted bg-surface">
        <div class="divide-y divide-edge-muted">{props.children}</div>
      </div>
    </Layer>
  );
}

function List(props: ToolListProps) {
  const grouped = useContext(GroupedContext);
  return (
    <div
      classList={{
        '-mx-3 -my-2': !grouped(),
        // Results read in the row's tone, not as brighter content under it.
        '[--color-ink:currentColor]': grouped(),
      }}
    >
      {props.children}
    </div>
  );
}

function ListItem(props: ToolListItemProps) {
  const grouped = useContext(GroupedContext);
  return (
    <div
      class="flex items-center gap-2 text-xs"
      classList={{
        'min-h-6 py-0.5 leading-5': grouped(),
        'min-h-8 px-3 py-1.5 leading-4': !grouped(),
      }}
    >
      <Show when={!grouped() && props.icon}>
        <div class="flex size-4 shrink-0 items-center justify-center text-ink-extra-muted">
          {props.icon}
        </div>
      </Show>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

/** A result that opens what it found. */
function ListButton(props: ToolListButtonProps) {
  const grouped = useContext(GroupedContext);
  return (
    <button
      type="button"
      class="w-full text-left"
      classList={{
        'grid items-center touch:min-h-[44px] not-touch:hover:text-ink-muted':
          grouped(),
        'block hover:bg-hover': !grouped(),
      }}
      onClick={(event) => props.onClick?.(event)}
    >
      {props.children}
    </button>
  );
}

export const Tool = {
  Group,
  List,
  ListButton,
  ListItem,
  Response,
  ResultToggle,
  Root,
  Row,
};
