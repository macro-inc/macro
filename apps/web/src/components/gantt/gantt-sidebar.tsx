import CaretLeftIcon from '@phosphor/caret-left.svg';
import ListIcon from '@phosphor/list-bullets.svg';
import { Button, cn, Layer, Surface } from '@ui';
import {
  type Accessor,
  createContext,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { useGantt } from './gantt-context';

/** Compose with labelWidth={0}; row labels share the calendar's native vertical scroll. */
export function GanttSidebarToggle() {
  const gantt = useGantt();
  onCleanup(() => gantt.sidebar.setTrigger(undefined));
  return (
    <div class="absolute left-3 top-2 z-40">
      <Button
        depth={2}
        ref={gantt.sidebar.setTrigger}
        size="icon-md"
        variant="outline"
        class="bg-surface shadow-sm"
        label={
          gantt.sidebar.open() ? 'Hide timeline items' : 'Show timeline items'
        }
        aria-expanded={gantt.sidebar.open()}
        disabled={gantt.editing()}
        onClick={() => gantt.sidebar.setOpen(!gantt.sidebar.open())}
      >
        <Show
          when={gantt.sidebar.open()}
          fallback={<ListIcon class="size-4" />}
        >
          <CaretLeftIcon class="size-4" />
        </Show>
      </Button>
    </div>
  );
}

const SidebarPanelContext = createContext<{
  first: Accessor<boolean>;
  last: Accessor<boolean>;
}>();

/** Adjacent rows share a panel, even when only part of the group is mounted. */
export function GanttSidebarPanelRow<T>(
  props: ParentProps<{
    items: readonly T[];
    index: number;
    getPanelKey?: (item: T) => string | number | undefined;
  }>
) {
  const key = (index: number) => {
    const item = props.items[index];
    if (item === undefined) return undefined;
    return props.getPanelKey ? props.getPanelKey(item) : '';
  };
  return (
    <SidebarPanelContext.Provider
      value={{
        first: () =>
          key(props.index) === undefined ||
          props.index === 0 ||
          key(props.index - 1) !== key(props.index),
        last: () =>
          key(props.index) === undefined ||
          props.index === props.items.length - 1 ||
          key(props.index + 1) !== key(props.index),
      }}
    >
      {props.children}
    </SidebarPanelContext.Provider>
  );
}

/** The panel and its contents clip together in the calendar's native viewport. */
export function GanttLabel(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'>
) {
  const gantt = useGantt();
  const panel = useContext(SidebarPanelContext);
  const [local, rest] = splitProps(props, ['children', 'class']);
  const drawer = () => gantt.labelWidth() === 0;
  const first = () => panel?.first() ?? true;
  const last = () => panel?.last() ?? true;
  const hidden = () => drawer() && !gantt.sidebar.open();
  return (
    <Layer depth={drawer() ? 1 : undefined}>
      <div
        {...rest}
        class={cn(
          'sticky z-20 flex min-w-0 items-center overflow-clip px-2 text-xs text-ink',
          !drawer() && 'left-0 h-full border-r border-edge-muted',
          drawer() &&
            'left-2 border-x border-edge-muted bg-surface light-mode:border-ink/15 light-mode:bg-[color-mix(in_oklch,var(--color-surface)_97%,var(--color-ink))] transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none',
          drawer() && first() && 'rounded-t-lg border-t',
          drawer() && last() && 'rounded-b-lg border-b',
          hidden() &&
            'invisible -translate-x-[calc(100%+8px)] pointer-events-none',
          local.class
        )}
        data-gantt-label=""
        data-gantt-panel-start={drawer() && first() ? '' : undefined}
        data-gantt-panel-end={drawer() && last() ? '' : undefined}
        aria-hidden={hidden() || undefined}
        inert={hidden()}
        style={{
          width: `${gantt.labelWidth() || Math.max(0, gantt.sidebar.width() - 16)}px`,
          height: drawer()
            ? `calc(100% - ${(first() ? 4 : 0) + (last() ? 4 : 0)}px)`
            : '100%',
          'margin-top': drawer() && first() ? '4px' : undefined,
        }}
      >
        {local.children}
      </div>
    </Layer>
  );
}

/** Each child supplies its own surface; the header only arranges the controls. */
export function GanttControls(props: ParentProps) {
  return (
    <div
      role="group"
      aria-label="Timeline controls"
      class="absolute right-3 top-2 z-40 flex items-center gap-2"
    >
      {props.children}
    </div>
  );
}

/** Group headings stay visible across the list and calendar, independent of the drawer. */
export function GanttGroupHeader(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'>
) {
  const gantt = useGantt();
  const [local, rest] = splitProps(props, ['children', 'class']);
  const width = () => {
    const visible = gantt.visibleRange();
    return (
      gantt.labelWidth() + (visible.end - visible.start) * gantt.pixelsPerDay()
    );
  };
  return (
    <Surface
      {...rest}
      depth={3}
      hideBorder
      data-gantt-group-header=""
      class={cn(
        'group/header sticky left-1 z-[25] my-0.5 flex h-[calc(100%-4px)] items-center rounded-lg border border-edge-muted text-xs font-medium text-ink-muted hover:bg-active',
        local.class
      )}
      style={{ width: `${Math.max(0, width() - 8)}px` }}
    >
      {local.children}
    </Surface>
  );
}

/** Pagination stays aligned to the visible calendar edge after horizontal panning. */
export function GanttPagination(props: ParentProps) {
  const gantt = useGantt();
  const inset = () =>
    gantt.labelWidth() || (gantt.sidebar.open() ? gantt.sidebar.width() : 0);
  const width = () => {
    const visible = gantt.visibleRange();
    return Math.max(
      0,
      gantt.labelWidth() +
        (visible.end - visible.start) * gantt.pixelsPerDay() -
        inset()
    );
  };
  return (
    <div
      data-gantt-pagination=""
      class="sticky z-20 flex h-full items-center px-4"
      style={{ left: `${inset()}px`, width: `${width()}px` }}
    >
      <Show when={width() >= 180}>{props.children}</Show>
    </div>
  );
}
