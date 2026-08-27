import {
  type BreakpointAccessors,
  type BreakpointThresholds,
  createSizeBreakpoints,
} from '@app/util/create-size-breakpoints';
import { Resize } from '@core/component/Resize';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import {
  type Accessor,
  createContext,
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  Show,
  Switch,
  splitProps,
  useContext,
} from 'solid-js';
import {
  type AsideLayout,
  type AsideMode,
  DEFAULT_ASIDE_LAYOUT,
  DEFAULT_DETAIL_LAYOUT,
  DEFAULT_LAYOUT_BREAKPOINT,
  DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS,
  type DetailLayout,
  type DetailPlacement,
} from './view-shell-layout';

export type ViewShellLayout = {
  width: Accessor<number | undefined>;
  /**
   * Keyed reactive breakpoints from {@link createSizeBreakpoints}.
   * Read as `breakpoints.narrow?.()`, `breakpoints.dense?.()`, …
   */
  breakpoints: BreakpointAccessors;
  aside: {
    layout: Accessor<AsideLayout>;
    mode: Accessor<AsideMode>;
    isCollapsed: Accessor<boolean>;
  };
  detail: {
    layout: Accessor<DetailLayout>;
    isOpen: Accessor<boolean>;
    placement: Accessor<DetailPlacement>;
    open: () => void;
    close: () => void;
    toggle: () => void;
  };
};

type ViewShellInternal = ViewShellLayout & { id: string };

const MAIN_MIN_WIDTH = 320;
const RESIZE_GUTTER = 8;

const ViewShellContext = createContext<ViewShellInternal>();

function useViewShellInternal(): ViewShellInternal {
  const ctx = useContext(ViewShellContext);
  if (!ctx) {
    throw new Error('ViewShell slots require <ViewShell.Root>');
  }
  return ctx;
}

export function useViewShell(): ViewShellLayout {
  const ctx = useViewShellInternal();
  return {
    width: ctx.width,
    breakpoints: ctx.breakpoints,
    aside: ctx.aside,
    detail: ctx.detail,
  };
}

export type ViewShellRootProps = Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  'children'
> & {
  children: JSX.Element;
  /**
   * Breakpoint thresholds passed to {@link createSizeBreakpoints}.
   * Each value is a max-width number or `{ min?, max? }`.
   * Defaults to {@link DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS} (`narrow: 720`).
   */
  breakpoints?: BreakpointThresholds;
  /**
   * Breakpoint key that drives aside collapse and detail narrow behavior.
   * Must exist on `breakpoints`. Defaults to `"narrow"`.
   */
  layoutBreakpoint?: string;
  /**
   * When true, Aside/Main/Detail panels expose drag gutters via Resize.
   * Defaults to false — panels still size via the Resize solver, without handles.
   */
  resizable?: boolean;
  aside?: Partial<AsideLayout>;
  detail?: Partial<DetailLayout>;
  /** Controlled detail open state. Omit for uncontrolled. */
  detailOpen?: boolean;
  /** Uncontrolled initial open state when `detailOpen` is omitted. */
  defaultDetailOpen?: boolean;
  onDetailOpenChange?: (open: boolean) => void;
};

/**
 * Root of one workspace. Owns measurement, panel track, detail open-state,
 * and layout context. Renders a plain div. Landmark elements come from
 * ViewSidebar and Main.
 */
function Root(props: ViewShellRootProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'breakpoints',
    'layoutBreakpoint',
    'resizable',
    'aside',
    'detail',
    'detailOpen',
    'defaultDetailOpen',
    'onDetailOpenChange',
  ]);

  const id = createUniqueId();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const size = createElementSize(root);

  const thresholds = (): BreakpointThresholds =>
    local.breakpoints ?? DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS;
  const layoutKey = () => {
    const key = local.layoutBreakpoint ?? DEFAULT_LAYOUT_BREAKPOINT;
    if (!(key in thresholds())) {
      throw new Error(
        `ViewShell layoutBreakpoint "${key}" is not defined in breakpoints`
      );
    }
    return key;
  };

  const asideLayout = (): AsideLayout => ({
    ...DEFAULT_ASIDE_LAYOUT,
    ...local.aside,
  });

  const detailLayout = (): DetailLayout => ({
    ...DEFAULT_DETAIL_LAYOUT,
    ...local.detail,
  });

  const controlled = () => local.detailOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    local.defaultDetailOpen ?? false
  );

  const isOpen = () =>
    controlled() ? (local.detailOpen ?? false) : uncontrolledOpen();

  const setOpen = (next: boolean) => {
    if (isOpen() === next) return;
    if (!controlled()) setUncontrolledOpen(next);
    local.onDetailOpenChange?.(next);
  };

  const resizable = () => local.resizable ?? false;
  const width = () => size.width ?? undefined;
  const breakpoints = createSizeBreakpoints(width, thresholds);

  const atLayoutBreakpoint = () => {
    const match = breakpoints[layoutKey()];
    return match ? match() : false;
  };

  const asideMode = (): AsideMode =>
    atLayoutBreakpoint() ? 'collapsed' : 'docked';

  const canFitInlineDetail = () => {
    const currentWidth = width();
    if (currentWidth === undefined) return false;

    const asideMin = asideMode() === 'docked' ? asideLayout().min : 0;
    const panelCount = asideMode() === 'docked' ? 3 : 2;
    const minimumWidth =
      asideMin +
      MAIN_MIN_WIDTH +
      detailLayout().min +
      (panelCount - 1) * RESIZE_GUTTER;
    return currentWidth >= minimumWidth;
  };

  const placement = (): DetailPlacement => {
    if (!isOpen()) return 'hidden';
    if (!atLayoutBreakpoint() && canFitInlineDetail()) return 'inline';

    const whenNarrow = detailLayout().whenNarrow;
    return whenNarrow === 'hide' ? 'hidden' : whenNarrow;
  };

  const value: ViewShellInternal = {
    id,
    width,
    breakpoints,
    aside: {
      layout: asideLayout,
      mode: asideMode,
      isCollapsed: () => asideMode() === 'collapsed',
    },
    detail: {
      layout: detailLayout,
      isOpen,
      placement,
      open: () => {
        setOpen(true);
      },
      close: () => {
        setOpen(false);
      },
      toggle: () => {
        setOpen(!isOpen());
      },
    },
  };

  return (
    <ViewShellContext.Provider value={value}>
      <div
        {...rest}
        ref={setRoot}
        class={cn(
          '@container/view-shell relative size-full min-h-0 min-w-0',
          local.class
        )}
        data-view-shell=""
        data-view-shell-layout={atLayoutBreakpoint() ? layoutKey() : undefined}
      >
        <Resize.Zone
          direction="horizontal"
          gutter={RESIZE_GUTTER}
          resizable={resizable()}
        >
          {local.children}
        </Resize.Zone>
      </div>
    </ViewShellContext.Provider>
  );
}

/**
 * Sizing region for navigation. Renders a div, not aside.
 * ViewSidebar.Root inside keeps the landmark.
 */
function Aside(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();

  return (
    <Resize.Panel
      id={`${ws.id}-aside`}
      index={0}
      minSize={ws.aside.layout().min}
      maxSize={ws.aside.layout().max}
      target={{ kind: 'px', px: ws.aside.layout().width }}
      collapsed={() => ws.aside.isCollapsed()}
    >
      <div
        {...rest}
        class={cn('size-full min-h-0 min-w-0', local.class)}
        data-view-shell-aside=""
      >
        {local.children}
      </div>
    </Resize.Panel>
  );
}

function Main(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();

  return (
    <Resize.Panel id={`${ws.id}-main`} index={1} minSize={MAIN_MIN_WIDTH}>
      <main
        {...rest}
        class={cn('flex size-full min-h-0 min-w-0 flex-col', local.class)}
        data-view-shell-main=""
      >
        {local.children}
      </main>
    </Resize.Panel>
  );
}

function Header(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <header
      {...rest}
      class={cn(
        'shrink-0 px-4 pb-5 pt-4 @max-[760px]/view-shell:px-3 @max-[480px]/view-shell:px-2',
        local.class
      )}
      data-view-shell-header=""
    >
      {local.children}
    </header>
  );
}

function Content(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();

  return (
    <Show when={ws.detail.placement() !== 'replace'}>
      <div
        {...rest}
        class={cn(
          'min-h-0 min-w-0 flex-1 px-4 pb-4 @max-[760px]/view-shell:px-3 @max-[480px]/view-shell:px-2',
          local.class
        )}
        data-view-shell-content=""
      >
        {local.children}
      </div>
    </Show>
  );
}

function Detail(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();
  const layout = ws.detail.layout;

  return (
    <Switch>
      <Match when={ws.detail.placement() === 'inline'}>
        <Resize.Panel
          id={`${ws.id}-detail`}
          index={2}
          minSize={layout().min}
          maxSize={layout().max}
          target={{ kind: 'px', px: layout().width }}
        >
          <div
            {...rest}
            class={cn('size-full min-h-0 min-w-0', local.class)}
            data-view-shell-detail=""
            data-view-shell-detail-placement="inline"
          >
            {local.children}
          </div>
        </Resize.Panel>
      </Match>
      <Match when={ws.detail.placement() === 'overlay'}>
        <div
          {...rest}
          class={cn(
            'absolute inset-y-0 right-0 z-10 min-h-0 border-l border-edge bg-panel shadow-menu',
            local.class
          )}
          style={{ width: `${layout().width}px`, 'max-width': '100%' }}
          data-view-shell-detail=""
          data-view-shell-detail-placement="overlay"
        >
          {local.children}
        </div>
      </Match>
      <Match when={ws.detail.placement() === 'replace'}>
        <div
          {...rest}
          class={cn('absolute inset-0 z-10 min-h-0 min-w-0', local.class)}
          data-view-shell-detail=""
          data-view-shell-detail-placement="replace"
        >
          {local.children}
        </div>
      </Match>
    </Switch>
  );
}

export const ViewShell = Object.assign(Root, {
  Root,
  Aside,
  Main,
  Header,
  Content,
  Detail,
});
