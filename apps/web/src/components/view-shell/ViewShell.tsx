import { usePreference } from '@app/preferences/use-preference';
import {
  type BreakpointAccessors,
  type BreakpointThresholds,
  createSizeBreakpoints,
} from '@app/util/create-size-breakpoints';
import { SplitPanelContext } from '@components/app/split-layout/context';
import { SplitPanel } from '@components/app/split-panel';
import { Resize } from '@core/component/Resize';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import ListIcon from '@phosphor/list.svg';
import SidebarIcon from '@phosphor/sidebar-simple.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, cn } from '@ui';
import {
  type Accessor,
  batch,
  type ComponentProps,
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
import { CollapseTransition } from './CollapseTransition';
import { createSidebarMotion } from './create-sidebar-motion';
import {
  type AsideLayout,
  type AsideMode,
  DEFAULT_ASIDE_LAYOUT,
  DEFAULT_DETAIL_LAYOUT,
  DEFAULT_LAYOUT_BREAKPOINT,
  DEFAULT_MAIN_LAYOUT,
  DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS,
  type DetailLayout,
  type DetailPlacement,
  type MainLayout,
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
    canCollapse: Accessor<boolean>;
    isOverlay: Accessor<boolean>;
    collapse: () => void;
    expand: () => void;
    toggle: () => void;
  };
  main: {
    layout: Accessor<MainLayout>;
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

type ViewShellInternal = ViewShellLayout & {
  id: string;
  atLayoutBreakpoint: Accessor<boolean>;
};

const RESIZE_GUTTER = 1;

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
    main: ctx.main,
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
  /** Set to false when the workspace has no navigation region. */
  aside?: false | Partial<AsideLayout>;
  /** Sticky navigation visibility, scoped to this app type rather than an entry. */
  asidePreferenceKey?: string;
  main?: Partial<MainLayout>;
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
    'asidePreferenceKey',
    'main',
    'detail',
    'detailOpen',
    'defaultDetailOpen',
    'onDetailOpenChange',
  ]);

  const [asideCollapsed, setAsideCollapsed] = local.asidePreferenceKey
    ? usePreference(
        `macro:pref:view-sidebar:collapsed:${local.asidePreferenceKey}`,
        { default: false }
      )
    : createSignal(false);
  const [narrowAsideOpen, setNarrowAsideOpen] = createSignal(false);
  const id = createUniqueId();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const animateSidebar = createSidebarMotion(root);
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
    ...(local.aside || {}),
  });

  const mainLayout = (): MainLayout => ({
    ...DEFAULT_MAIN_LAYOUT,
    ...local.main,
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
    local.aside === false ||
    asideCollapsed() ||
    (atLayoutBreakpoint() && !narrowAsideOpen())
      ? 'collapsed'
      : 'docked';
  const asideOverlay = () => atLayoutBreakpoint() && asideMode() === 'docked';

  const canFitInlineDetail = () => {
    const currentWidth = width();
    if (currentWidth === undefined) return false;

    const asideMin =
      asideMode() === 'docked' && !asideOverlay() ? asideLayout().min : 0;
    const panelCount = asideMode() === 'docked' && !asideOverlay() ? 3 : 2;
    const minimumWidth =
      asideMin +
      mainLayout().min +
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
    atLayoutBreakpoint,
    aside: {
      layout: asideLayout,
      mode: asideMode,
      isCollapsed: () => asideMode() === 'collapsed',
      canCollapse: () =>
        local.asidePreferenceKey !== undefined && local.aside !== false,
      isOverlay: asideOverlay,
      collapse: () => {
        animateSidebar(() =>
          batch(() => {
            setAsideCollapsed(true);
            setNarrowAsideOpen(false);
          })
        );
      },
      expand: () => {
        animateSidebar(() =>
          batch(() => {
            setAsideCollapsed(false);
            setNarrowAsideOpen(true);
          })
        );
      },
      toggle: () => {
        if (value.aside.isCollapsed()) value.aside.expand();
        else value.aside.collapse();
      },
    },
    main: {
      layout: mainLayout,
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

  const panel = useContext(SplitPanelContext);
  if (panel) {
    registerHotkey({
      hotkey: 'cmd+.',
      hotkeyToken: TOKENS.workspace.toggleNavigation,
      scopeId: panel.splitHotkeyScope,
      description: 'Toggle workspace navigation',
      condition: () => panel.isPanelActive() && value.aside.canCollapse(),
      runWithInputFocused: true,
      keyDownHandler: () => {
        value.aside.toggle();
        return true;
      },
    });
  }

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
type ViewShellAsideProps = JSX.HTMLAttributes<HTMLDivElement> & {
  /** Called with the solved aside width after a drag or keyboard resize. */
  onWidthChangeEnd?: (width: number) => void;
};

function Aside(props: ViewShellAsideProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'onWidthChangeEnd',
  ]);
  const ws = useViewShellInternal();
  const [resizedWidth, setResizedWidth] = createSignal<{
    configuredWidth: number;
    width: number;
    mainWidth?: number;
  }>();
  const resizePreference = () => {
    const resized = resizedWidth();
    return resized?.configuredWidth === ws.aside.layout().width
      ? resized
      : undefined;
  };
  const preferredWidth = () => {
    return resizePreference()?.width ?? ws.aside.layout().width;
  };
  const onWidthChangeEnd = (width: number) => {
    const shellWidth = ws.width();
    // A drag also chooses how much space Main gives up. Keeping its old soft
    // preference would immediately undo a drag made in a constrained shell.
    const mainWidth =
      shellWidth !== undefined && ws.detail.placement() !== 'inline'
        ? shellWidth - RESIZE_GUTTER - width
        : undefined;
    batch(() => {
      local.onWidthChangeEnd?.(width);
      // A consumer may persist the width back into the layout in this callback.
      setResizedWidth({
        configuredWidth: ws.aside.layout().width,
        width,
        mainWidth,
      });
    });
  };
  const redistributionPreferredSize = () => {
    const layout = ws.aside.layout();
    const width = preferredWidth();
    if (layout.preserveDuringResize !== false) return width;

    const shellWidth = ws.width();
    const mainLayout = ws.main.layout();
    if (
      shellWidth === undefined ||
      mainLayout.preferredWidth === undefined ||
      ws.detail.placement() === 'inline'
    ) {
      return width;
    }

    const availableForAside =
      shellWidth -
      RESIZE_GUTTER -
      Math.max(
        Math.min(
          mainLayout.preferredWidth,
          resizePreference()?.mainWidth ?? Infinity
        ),
        mainLayout.min
      );

    return Math.min(width, Math.max(layout.min, availableForAside));
  };

  let overlayAside: HTMLDivElement | undefined;
  const overlayWidth = () =>
    Math.min(preferredWidth(), ws.width() ?? preferredWidth());

  // Layout owns the host: closing an overlay must not mount a second sidebar
  // while its exit animation is still retaining the first one.
  return (
    <Show
      when={ws.atLayoutBreakpoint()}
      fallback={
        <Resize.Panel
          id={`${ws.id}-aside`}
          index={0}
          minSize={ws.aside.layout().min}
          maxSize={ws.aside.layout().max}
          redistributionPreferredSize={redistributionPreferredSize()}
          target={{ kind: 'px', px: preferredWidth() }}
          collapsed={() => ws.aside.isCollapsed()}
          onSizeChangeEnd={onWidthChangeEnd}
        >
          <div
            {...rest}
            class={cn('size-full min-h-0 min-w-0', local.class)}
            data-view-shell-aside=""
            inert={ws.aside.isCollapsed()}
            aria-hidden={ws.aside.isCollapsed()}
          >
            {local.children}
          </div>
        </Resize.Panel>
      }
    >
      <CollapseTransition
        open={ws.aside.isOverlay()}
        axis="width"
        container={() => overlayAside}
      >
        <div
          class="absolute inset-0 z-20"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              ws.aside.collapse();
            }
          }}
        >
          <button
            type="button"
            aria-label="Close navigation backdrop"
            class="absolute inset-0 bg-modal-overlay"
            onClick={ws.aside.collapse}
          />
          <div
            {...rest}
            class={cn(
              'relative h-full max-w-full bg-panel shadow-menu',
              local.class
            )}
            ref={overlayAside}
            style={{ width: `${overlayWidth()}px` }}
            data-view-shell-aside=""
          >
            {/* Keep text at its resting width while the outer frame reveals it. */}
            <div class="h-full" style={{ width: `${overlayWidth()}px` }}>
              {local.children}
            </div>
          </div>
        </div>
      </CollapseTransition>
    </Show>
  );
}

/** A navigation overlay must not offer an action that closes its owning split. */
export function ViewSidebarCloseButton(
  props: ComponentProps<typeof SplitPanel.CloseButton>
) {
  const ws = useContext(ViewShellContext);
  return (
    <Show when={!ws?.atLayoutBreakpoint()}>
      <SplitPanel.CloseButton {...props} />
    </Show>
  );
}

/** Safe outside a shell so block preview headers can share this control. */
export function ViewSidebarToggle(props: { action: 'collapse' | 'expand' }) {
  const ws = useContext(ViewShellContext);
  const visible = () =>
    ws?.aside.canCollapse() &&
    (props.action === 'expand'
      ? ws.aside.isCollapsed() || ws.aside.isOverlay()
      : !ws.aside.isCollapsed());
  return (
    <Show when={visible()}>
      <Button
        variant="ghost"
        size="icon-sm"
        class={cn(
          'shrink-0 touch:hidden',
          props.action === 'collapse' && 'ml-auto',
          props.action === 'collapse' &&
            ws?.aside.isOverlay() &&
            'motion-safe:animate-[dialog-overlay-open_60ms_ease-out_80ms_both]'
        )}
        label={
          props.action === 'expand' ? 'Show navigation' : 'Hide navigation'
        }
        hotkey={TOKENS.workspace.toggleNavigation}
        aria-expanded={props.action !== 'expand'}
        data-view-sidebar-toggle={props.action}
        onClick={(event) => {
          const shell = event.currentTarget.closest('[data-view-shell]');
          if (props.action === 'expand') ws?.aside.expand();
          else ws?.aside.collapse();
          const nextAction = props.action === 'expand' ? 'collapse' : 'expand';
          queueMicrotask(() =>
            shell
              ?.querySelector<HTMLButtonElement>(
                `[data-view-sidebar-toggle="${nextAction}"]`
              )
              ?.focus()
          );
        }}
      >
        <Show
          when={props.action === 'expand'}
          fallback={<SidebarIcon class="size-4" />}
        >
          <ListIcon class="size-4" />
        </Show>
      </Button>
    </Show>
  );
}

/** Shared leading controls, kept in place beneath navigation overlays. */
export function ViewNavigationControls() {
  const ws = useContext(ViewShellContext);
  return (
    <Show when={ws?.aside.isCollapsed() || ws?.aside.isOverlay()}>
      <SplitPanel.ControlGroup
        inert={ws?.aside.isOverlay()}
        aria-hidden={ws?.aside.isOverlay()}
      >
        <SplitPanel.CloseButton />
        <ViewSidebarToggle action="expand" />
      </SplitPanel.ControlGroup>
    </Show>
  );
}

function Main(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();
  const layout = ws.main.layout;
  const target = () => {
    const width = layout().width;
    if (ws.detail.placement() !== 'inline' || width === undefined) {
      return undefined;
    }
    return { kind: 'px' as const, px: width };
  };

  return (
    <Resize.Panel
      id={`${ws.id}-main`}
      index={1}
      minSize={layout().min}
      maxSize={ws.detail.placement() === 'inline' ? layout().max : undefined}
      target={target()}
    >
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

function TopBar(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'flex h-12 min-w-0 shrink-0 items-center gap-1 border-b border-edge-muted px-2 py-3 not-touch:pl-[13px] touch:hidden',
        local.class
      )}
      data-view-shell-top-bar=""
    >
      <ViewNavigationControls />
      {local.children}
    </div>
  );
}

function Header(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <header
      {...rest}
      class={cn(
        'shrink-0 px-4 py-4 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--safe-top,0px)+0.5rem)]',
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
          'min-h-0 min-w-0 flex-1 px-4 pb-4 @max-[760px]/view-shell:px-3 @max-[720px]/view-shell:pb-2 @max-[480px]/view-shell:px-2',
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
  const target = () => {
    const initialWidth = layout().initialWidth;
    if (initialWidth === 'auto') return undefined;
    return {
      kind: 'px' as const,
      px: initialWidth ?? layout().width,
    };
  };

  return (
    <Switch>
      <Match when={ws.detail.placement() === 'inline'}>
        <Resize.Panel
          id={`${ws.id}-detail`}
          index={2}
          minSize={layout().min}
          maxSize={layout().max}
          target={target()}
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
            'absolute inset-y-0 right-0 z-10 min-h-0 border-l border-edge-muted bg-panel shadow-menu',
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
  TopBar,
  Header,
  Content,
  Detail,
});
