import { t } from '@app/lib/i18n';
import { usePreference } from '@app/preferences/use-preference';
import {
  type BreakpointAccessors,
  type BreakpointThresholds,
  createSizeBreakpoints,
} from '@app/util/create-size-breakpoints';
import { SplitHeaderContextMenu } from '@components/app/split-layout/components/SplitHeaderContextMenu';
import { SplitPanelContext } from '@components/app/split-layout/context';
import { SplitPanel } from '@components/app/split-panel';
import { Resize } from '@core/component/Resize';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { createWritableMemo } from '@solid-primitives/memo';
import { mergeRefs } from '@solid-primitives/refs';
import { Button, cn } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { tourTarget } from '@ui/components/Tour';
import {
  type Accessor,
  batch,
  type ComponentProps,
  createComputed,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  on,
  Show,
  Switch,
  splitProps,
  untrack,
  useContext,
} from 'solid-js';
import { createFrameWidth } from './create-frame-width';
import { createSidebarMotion } from './create-sidebar-motion';
import { VIEW_SHELL_TOUR } from './tour';
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
  asideHost: Accessor<'docked' | 'closing' | 'overlay'>;
  /** Which of a list aside and Main fills a narrow shell; undefined otherwise. */
  narrowList: Accessor<'list' | 'main' | undefined>;
  returnToList: () => void;
  chooseAsideWidth: (width: number) => void;
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
  /**
   * Sticky navigation visibility and width, scoped to this app type rather
   * than an entry. Only the first split follows the saved visibility; other
   * splits start collapsed. Every split opens at the last saved width; a drag
   * in one split leaves the others' current widths alone.
   */
  asidePreferenceKey?: string;
  /**
   * Keep navigation open while true, e.g. while Main has nothing selected and
   * only the aside offers a next step. Wide layouts dock it and withhold the
   * collapse control without touching the saved preference; narrow layouts
   * open the overlay, which stays dismissible.
   */
  asideRequired?: boolean;
  /**
   * Keep navigation docked in wide layouts, for views that are unusable
   * without it. Like `asideRequired`, it withholds the collapse control and
   * ignores the saved preference there; narrow layouts still start with the
   * overlay closed.
   */
  asidePinned?: boolean;
  /**
   * For a view whose aside holds its entity list and whose Main shows the
   * entity open from it. Narrow layouts then show one of them at full width
   * instead of the navigation overlay: the list until `open`, then Main, with
   * a back button that calls `onBack` in place of Show navigation.
   */
  asideList?: { open: boolean; onBack: () => void };
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
    'asideRequired',
    'asidePinned',
    'asideList',
    'main',
    'detail',
    'detailOpen',
    'defaultDetailOpen',
    'onDetailOpenChange',
  ]);

  const panel = useContext(SplitPanelContext);
  // A view opened beside another split starts without navigation, then keeps
  // that split's choice as the split moves between views; only the primary
  // split follows, and writes, the saved preference.
  const secondarySplit =
    local.asidePreferenceKey !== undefined &&
    panel !== undefined &&
    !untrack(panel.handle.isFirst);
  const [wideAsideCollapsed, setWideAsideCollapsed] = secondarySplit
    ? (panel?.navigationCollapsed ?? createSignal(true))
    : local.asidePreferenceKey
      ? usePreference(
          `macro:pref:view-sidebar:collapsed:${local.asidePreferenceKey}`,
          { default: false }
        )
      : createSignal(false);
  // A width the user dragged to wins over the configured default.
  const [chosenAsideWidth, setChosenAsideWidth] = local.asidePreferenceKey
    ? usePreference<number | undefined>(
        `macro:pref:view-sidebar:width:${local.asidePreferenceKey}`,
        { default: undefined }
      )
    : createSignal<number>();
  const id = createUniqueId();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const animateSidebar = createSidebarMotion(root);
  const width = createFrameWidth(root);

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

  const asideLayout = (): AsideLayout => {
    const layout = { ...DEFAULT_ASIDE_LAYOUT, ...(local.aside || {}) };
    const chosen = chosenAsideWidth();
    // A saved width from older bounds still fits the current ones.
    if (chosen === undefined || !Number.isFinite(chosen)) return layout;

    return {
      ...layout,
      width: Math.min(layout.max, Math.max(layout.min, chosen)),
    };
  };

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
  const breakpoints = createSizeBreakpoints(width, thresholds);

  const atLayoutBreakpoint = () => {
    const match = breakpoints[layoutKey()];
    return match ? match() : false;
  };

  // Retain the docked panel only while its narrow-layout exit is animating.
  const [asideHost, setAsideHost] = createSignal<
    'docked' | 'closing' | 'overlay'
  >(untrack(atLayoutBreakpoint) ? 'overlay' : 'docked');
  const asideRequired = () => local.asideRequired ?? false;
  // Each narrow layout starts closed, independently of the saved wide layout,
  // unless navigation is required, which opens the overlay until dismissed.
  const [narrowAsideOpen, setNarrowAsideOpen] = createWritableMemo<boolean>(
    on([atLayoutBreakpoint, asideRequired], ([, required]) => required)
  );
  // Only a docked aside can be pinned open: a pinned overlay would hide Main
  // behind a backdrop with no way to dismiss it.
  const asidePinned = () =>
    (asideRequired() || (local.asidePinned ?? false)) && !atLayoutBreakpoint();
  // A list aside takes turns with Main in narrow layouts rather than
  // overlaying it, so the overlay and its open state don't apply there.
  const narrowList = (): 'list' | 'main' | undefined => {
    if (!local.asideList || local.aside === false || !atLayoutBreakpoint()) {
      return undefined;
    }
    return local.asideList.open ? 'main' : 'list';
  };

  const asideMode = (): AsideMode => {
    const list = narrowList();
    if (list) return list === 'list' ? 'docked' : 'collapsed';

    return local.aside === false ||
      (atLayoutBreakpoint()
        ? !narrowAsideOpen()
        : wideAsideCollapsed() && !asidePinned())
      ? 'collapsed'
      : 'docked';
  };
  const asideOverlay = () =>
    atLayoutBreakpoint() && !narrowList() && asideMode() === 'docked';

  const setAsideOpen = (open: boolean) => {
    if (narrowList()) return;
    if (!open && asidePinned()) return;
    // Repeated requests must not cancel an exit that still owns host cleanup.
    if (open === (asideMode() === 'docked')) return;
    animateSidebar(() => {
      if (atLayoutBreakpoint()) {
        // An explicit overlay replaces an unfinished docked exit.
        if (open) setAsideHost('overlay');
        setNarrowAsideOpen(open);
      } else setWideAsideCollapsed(!open);
    });
  };
  // Keep the last measured breakpoint while the view is detached or hidden.
  const measuredLayoutBreakpoint = createMemo<boolean | undefined>(
    (previous) => {
      const currentWidth = width();
      return currentWidth === undefined || currentWidth <= 0
        ? previous
        : atLayoutBreakpoint();
    }
  );
  // Measure the old host before the slots react to a breakpoint transition.
  createComputed(
    on(measuredLayoutBreakpoint, (narrow, previous) => {
      if (narrow === undefined || narrow === previous) return;
      // The first measurable layout is not a user-initiated resize.
      if (previous === undefined) {
        setAsideHost(narrow ? 'overlay' : 'docked');
        return;
      }
      const docked = Array.from(
        root()?.querySelectorAll<HTMLElement>(
          ':scope > [data-resize-zone] > [data-resize-panel]'
        ) ?? []
      ).find((panel) => panel.querySelector('[data-view-shell-aside]'));
      const retain =
        narrow &&
        !local.asideList &&
        !asideRequired() &&
        !!docked &&
        !docked.classList.contains('hidden');
      animateSidebar(
        () => {
          if (!narrow) setAsideHost('docked');
          else setAsideHost(retain ? 'closing' : 'overlay');
        },
        () => {
          if (narrow) setAsideHost('overlay');
        }
      );
    })
  );
  // Pin changes animate the current docked host, but cannot interrupt its exit.
  createComputed(
    on(
      [() => local.asidePinned, asideRequired],
      () => {
        if (!atLayoutBreakpoint()) animateSidebar(() => {});
        else if (asideRequired()) {
          animateSidebar(() => setAsideHost('overlay'));
        }
      },
      { defer: true }
    )
  );

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
    asideHost,
    narrowList,
    returnToList: () => local.asideList?.onBack(),
    chooseAsideWidth: setChosenAsideWidth,
    aside: {
      layout: asideLayout,
      mode: asideMode,
      isCollapsed: () => asideMode() === 'collapsed',
      canCollapse: () =>
        local.asidePreferenceKey !== undefined &&
        local.aside !== false &&
        !asidePinned() &&
        !narrowList(),
      isOverlay: asideOverlay,
      collapse: () => setAsideOpen(false),
      expand: () => setAsideOpen(true),
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

  if (panel) {
    registerHotkey({
      hotkey: 'cmd+.',
      hotkeyToken: TOKENS.workspace.toggleNavigation,
      scopeId: panel.splitHotkeyScope,
      description: 'Toggle navigation',
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
function Aside(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const ws = useViewShellInternal();
  return (
    <Show when={ws.narrowList()} fallback={<AsideHost {...props} />}>
      <NarrowListAside {...props} />
    </Show>
  );
}

/**
 * A narrow list fills the shell over Main, which waits beneath it. While an
 * entity is open the list stays mounted but hidden, so it keeps its scroll.
 */
function NarrowListAside(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();
  const asideTarget = tourTarget(VIEW_SHELL_TOUR.aside);
  const hidden = () => ws.narrowList() === 'main';
  let list: HTMLDivElement | undefined;

  // Back leaves with the entity it was on; hand focus to the list, unless
  // the user has already moved it outside this view.
  createEffect(
    on(
      hidden,
      (isHidden) => {
        if (isHidden || !list) return;
        const active = document.activeElement;
        const shell = list.closest('[data-view-shell]');
        // Removing a focused scope hands focus to the pane around this view.
        const focusLost =
          !active || active === document.body || active.contains(shell);
        if (!focusLost && !shell?.contains(active)) return;
        if (list.contains(active)) return;

        list.focus({ preventScroll: true });
      },
      { defer: true }
    )
  );

  return (
    <div
      {...rest}
      ref={(element) => {
        list = element;
        asideTarget(element);
      }}
      tabIndex={-1}
      class={cn(
        'absolute inset-0 z-20 min-h-0 bg-panel outline-none',
        hidden() && 'invisible',
        local.class
      )}
      data-view-shell-aside=""
      inert={hidden()}
      aria-hidden={hidden()}
    >
      {local.children}
    </div>
  );
}

/** Docked or overlay navigation, whichever the layout hosts. */
function AsideHost(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const ws = useViewShellInternal();
  const asideTarget = tourTarget(VIEW_SHELL_TOUR.aside);
  // Main's width after this mount's last drag; only the aside width is saved.
  const [resizedMainWidth, setResizedMainWidth] = createSignal<number>();
  const preferredWidth = () => ws.aside.layout().width;
  const onWidthChangeEnd = (width: number) => {
    const shellWidth = ws.width();
    // A drag also chooses how much space Main gives up. Keeping its old soft
    // preference would immediately undo a drag made in a constrained shell.
    const mainWidth =
      shellWidth !== undefined && ws.detail.placement() !== 'inline'
        ? shellWidth - RESIZE_GUTTER - width
        : undefined;
    batch(() => {
      ws.chooseAsideWidth(width);
      setResizedMainWidth(mainWidth);
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
        Math.min(mainLayout.preferredWidth, resizedMainWidth() ?? Infinity),
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
      when={ws.asideHost() === 'overlay'}
      fallback={
        <Resize.Panel
          id={`${ws.id}-aside`}
          index={0}
          minSize={ws.aside.layout().min}
          maxSize={ws.aside.layout().max}
          redistributionPreferredSize={redistributionPreferredSize()}
          target={{ kind: 'px', px: preferredWidth() }}
          collapsed={() =>
            ws.atLayoutBreakpoint()
              ? ws.asideHost() === 'closing'
              : ws.aside.isCollapsed()
          }
          onSizeChangeEnd={onWidthChangeEnd}
        >
          <div
            {...rest}
            ref={asideTarget}
            class={cn('size-full min-h-0 min-w-0', local.class)}
            data-view-shell-aside=""
            inert={ws.atLayoutBreakpoint() || ws.aside.isCollapsed()}
            aria-hidden={ws.atLayoutBreakpoint() || ws.aside.isCollapsed()}
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
            // Portaled menus own Escape even though Solid bubbles through here.
            if (
              event.key === 'Escape' &&
              !event.defaultPrevented &&
              event.currentTarget.contains(event.target as Node) &&
              !(event.target as Element).closest(
                '[aria-haspopup][aria-expanded="true"]'
              )
            ) {
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
            ref={(element) => {
              overlayAside = element;
              asideTarget(element);
            }}
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

/** Keep split close available in both docked and overlay navigation. */
export function ViewSidebarCloseButton(
  props: ComponentProps<typeof SplitPanel.CloseButton>
) {
  const [local, rest] = splitProps(props, ['children', 'size']);
  return (
    <SplitPanel.CloseButton {...rest} size={local.size ?? 'icon-xs'}>
      {local.children ?? <CloseIcon class="size-4" />}
    </SplitPanel.CloseButton>
  );
}

/** Safe outside a shell so block preview headers can share this control. */
export function ViewSidebarToggle(props: { action: 'collapse' | 'expand' }) {
  const ws = useContext(ViewShellContext);
  // A conditional expression as `ref` is dropped by the Solid compiler, so
  // only the expand toggle registers, from inside the callback.
  const toggleTarget = tourTarget(VIEW_SHELL_TOUR.sidebarToggle);
  const visible = () =>
    ws?.aside.canCollapse() &&
    (props.action === 'expand'
      ? ws.aside.isCollapsed() || ws.aside.isOverlay()
      : !ws.aside.isCollapsed());
  // Show and Hide are separate actions, not a persistently pressed toggle.
  return (
    <Show when={visible()}>
      <Button
        aria-label={
          props.action === 'expand' ? 'Show navigation' : 'Hide navigation'
        }
        tooltip={{
          content:
            props.action === 'expand' ? 'Show navigation' : 'Hide navigation',
          hotkey: TOKENS.workspace.toggleNavigation,
        }}
        variant="ghost"
        size="icon-xs"
        class={cn(
          'shrink-0 touch:hidden',
          props.action === 'collapse' && 'ml-auto',
          props.action === 'collapse' &&
            ws?.aside.isOverlay() &&
            'motion-safe:animate-[dialog-overlay-open_60ms_ease-out_80ms_both]'
        )}
        ref={(element) => {
          if (props.action === 'expand') toggleTarget(element);
        }}
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
        <SidebarIcon class="size-4" />
      </Button>
    </Show>
  );
}

/** Takes a narrow list view from the open entity back to its list. */
function ViewListBackButton(props: { onClick: () => void }) {
  return (
    <Button
      aria-label={t('common.back')}
      tooltip={t('common.back')}
      variant="ghost"
      size="icon-xs"
      class="shrink-0"
      // The way out of an inline preview is reachable before it is used.
      data-allow-focus-in-preview
      onClick={() => props.onClick()}
    >
      <ArrowLeftIcon class="size-4" />
    </Button>
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
        <Show
          when={ws?.narrowList() === 'main'}
          fallback={<ViewSidebarToggle action="expand" />}
        >
          <ViewListBackButton onClick={() => ws?.returnToList()} />
        </Show>
      </SplitPanel.ControlGroup>
    </Show>
  );
}

type ViewShellMainProps = JSX.HTMLAttributes<HTMLElement> & {
  /** Called with the solved width after a drag beside an inline detail. */
  onWidthChangeEnd?: (width: number) => void;
};

function Main(props: ViewShellMainProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'ref',
    'onWidthChangeEnd',
  ]);
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
      onSizeChangeEnd={local.onWidthChangeEnd}
    >
      <main
        {...rest}
        ref={mergeRefs(local.ref, tourTarget(VIEW_SHELL_TOUR.main))}
        class={cn('flex size-full min-h-0 min-w-0 flex-col', local.class)}
        data-view-shell-main=""
        inert={ws.narrowList() === 'list'}
        aria-hidden={ws.narrowList() === 'list'}
      >
        {local.children}
      </main>
    </Resize.Panel>
  );
}

function TopBar(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class', 'ref']);
  return (
    <SplitHeaderContextMenu>
      <div
        {...rest}
        ref={mergeRefs(local.ref, tourTarget(VIEW_SHELL_TOUR.topBar))}
        class={cn(
          '@container/split-header flex h-12 min-w-0 shrink-0 items-center gap-1 px-2 py-3 not-touch:gap-2 not-touch:py-2 not-touch:pl-3 touch:hidden',
          local.class
        )}
        data-view-shell-top-bar=""
      >
        <ViewNavigationControls />
        {local.children}
      </div>
    </SplitHeaderContextMenu>
  );
}

function Header(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <header
      {...rest}
      class={cn(
        'shrink-0 px-4 py-4 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.5rem)]',
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
        class={cn('min-h-0 min-w-0 flex-1', local.class)}
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
            'absolute inset-y-0 right-0 z-10 min-h-0 border-l border-edge-frame bg-panel shadow-menu',
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
