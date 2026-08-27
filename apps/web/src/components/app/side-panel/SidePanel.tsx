import { usePreference } from '@app/preferences/use-preference';
import { Resize, ResizeZoneContext } from '@core/component/Resize/Resize';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import SidePanelIcon from '@icon/square-half-filled.svg';
import { Accordion } from '@kobalte/core/accordion';
import ArrowLeft from '@phosphor/arrow-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import InfoIcon from '@phosphor/info.svg';
import { Button, Panel, Scroll } from '@ui';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  children,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  type Setter,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { HeaderIsland } from '../split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '../split-layout/components/SplitHeader';
import {
  SidePanelContext,
  type SidePanelContextType,
  type SidePanelSectionEntry,
} from './context';
import { registerSidePanelInstance } from './registry';

const NARROW_THRESHOLD_PX = 1224;
const SIDE_MIN_PX = 320;
const SIDE_MAX_PX = 380;
const MAIN_MIN_PX = 320;

/**
 * Wide-mode open state for a side panel.
 *
 * With a `persistKey`, the user's show/hide choice is remembered across
 * visits under a per-block localStorage key; without one the panel falls back
 * to a plain signal that resets to `defaultOpen` on every mount.
 *
 * Only wide mode is persisted. Narrow mode renders the panel as a full-screen
 * overlay on top of the content, so restoring it open would hide the content
 * the user came back to.
 */
function createWideOpenState(
  persistKey: string | undefined,
  defaultOpen: boolean
): [Accessor<boolean>, Setter<boolean>] {
  if (persistKey === undefined) return createSignal(defaultOpen);
  return usePreference(`macro:pref:side-panel:open:${persistKey}`, {
    default: defaultOpen,
  });
}

/**
 * Layout root for a block that opts in to a right-side panel.
 *
 * Wraps `props.children` in a horizontal Resize.Zone with a main panel
 * (the children) and a side panel that hosts any `<SidePanel.Section>`
 * descendants registered via context.
 *
 * Two rendering modes based on available width:
 *   - Wide (>= NARROW_THRESHOLD_PX, non-mobile): side panel renders as a
 *     resizable split next to the main content. Defaults to open unless
 *     `defaultOpen` is false.
 *   - Narrow (mobile or narrower than threshold): side panel renders as a
 *     full-screen overlay covering the main content. Defaults to closed;
 *     the main content stays mounted underneath.
 *
 * The side panel is suppressed entirely when no sections are registered.
 *
 * Pass `persistKey` to remember the wide-mode open state across visits (see
 * `createWideOpenState`); without it the panel returns to `defaultOpen` every
 * time the block mounts.
 *
 * Sections are rendered as a Kobalte Accordion in JSX-declared order.
 */
function Layout(
  props: ParentProps<{ defaultOpen?: boolean; persistKey?: string }>
) {
  const [sections, setSections] = createSignal<SidePanelSectionEntry[]>([]);
  const [openIds, setOpenIds] = createSignal<string[]>([]);
  // Independent open state per mode so wide and narrow can have different
  // defaults (and the user's preference in one mode doesn't bleed into the
  // other after a resize).
  const [isWideOpen, setIsWideOpen] = createWideOpenState(
    props.persistKey,
    props.defaultOpen ?? true
  );
  const [isNarrowOpen, setIsNarrowOpen] = createSignal(false);
  const [isNarrow, setIsNarrow] = createSignal(isMobile());

  const isOpen = () => (isNarrow() ? isNarrowOpen() : isWideOpen());
  const setIsOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const setter = isNarrow() ? setIsNarrowOpen : setIsWideOpen;
    setter(typeof next === 'function' ? next : () => next);
  };
  const toggle = () => setIsOpen((prev) => !prev);

  // Let global chrome shortcuts (cmd+.) hide/show this panel alongside the
  // app sidebar.
  onCleanup(registerSidePanelInstance({ setIsOpen, isNarrow }));

  const register = (entry: SidePanelSectionEntry) => {
    setSections((prev) => {
      const next = prev.filter((s) => s.id !== entry.id);
      next.push(entry);
      return next;
    });
    if (entry.defaultOpen) {
      setOpenIds((prev) =>
        prev.includes(entry.id) ? prev : [...prev, entry.id]
      );
    }
  };

  const unregister = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
    setOpenIds((prev) => prev.filter((v) => v !== id));
  };

  const hasSections = createMemo(() => sections().length > 0);

  const ctx: SidePanelContextType = {
    register,
    unregister,
    sections,
    hasSections,
    isOpen,
    setIsOpen,
    toggle,
    isNarrow,
    setOpenSectionIds: setOpenIds,
    openSectionIds: openIds,
  };

  return (
    <SidePanelContext.Provider value={ctx}>
      <SidePanelHeaderToggle />
      <Resize.Zone direction="horizontal" gutter={0} resizable={false}>
        <SidePanelLayoutInner
          sections={sections}
          openIds={openIds}
          setOpenIds={setOpenIds}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          setIsNarrow={setIsNarrow}
        >
          {props.children}
        </SidePanelLayoutInner>
      </Resize.Zone>
    </SidePanelContext.Provider>
  );
}

function SidePanelLayoutInner(
  props: ParentProps<{
    sections: Accessor<SidePanelSectionEntry[]>;
    openIds: Accessor<string[]>;
    setOpenIds: (ids: string[]) => void;
    isOpen: Accessor<boolean>;
    setIsOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
    setIsNarrow: Setter<boolean>;
  }>
) {
  const resolved = children(() => props.children);
  const zoneCtx = useContext(ResizeZoneContext);

  if (!zoneCtx) {
    throw new Error('SidePanelLayoutInner must be rendered inside Resize.Zone');
  }

  const isNarrow = createMemo(
    () => isMobile() || zoneCtx.size() < NARROW_THRESHOLD_PX
  );
  const hasSections = createMemo(() => props.sections().length > 0);

  createEffect(() => props.setIsNarrow(isNarrow()));

  const showSplit = createMemo(
    () => !isNarrow() && hasSections() && props.isOpen()
  );
  const showOverlay = createMemo(
    () => isNarrow() && hasSections() && props.isOpen()
  );

  return (
    <>
      <Resize.Panel id="side-panel-main" minSize={MAIN_MIN_PX} index={0}>
        {resolved()}
      </Resize.Panel>
      <Show when={showSplit()}>
        <Resize.Panel
          id="side-panel-side"
          minSize={SIDE_MIN_PX}
          maxSize={SIDE_MAX_PX}
          index={1}
        >
          <div class={'relative size-full z-split-panel-chrome'}>
            <SidePanelOutlet
              sections={props.sections}
              openIds={props.openIds}
              setOpenIds={props.setOpenIds}
            />
          </div>
        </Resize.Panel>
      </Show>
      <Show when={showOverlay()}>
        <div
          class={cn(
            'absolute inset-0 flex flex-col bg-surface z-split-panel-chrome'
          )}
        >
          <Scroll>
            {/* Full-frame mobile: the overlay spans the whole panel, so the
                content must clear the floating header islands + status bar. */}
            <div class="w-full max-w-2xl mx-auto min-w-0 touch:pt-(--mobile-content-inset-top)">
              <div class="px-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  class="gap-2 px-2 text-ink-muted"
                  onClick={() => props.setIsOpen(false)}
                >
                  <ArrowLeft class="size-4" />
                  Back to content
                </Button>
              </div>
              <SidePanelOutlet
                sections={props.sections}
                openIds={props.openIds}
                setOpenIds={props.setOpenIds}
              />
            </div>
          </Scroll>
        </div>
      </Show>
    </>
  );
}

function SidePanelHeaderToggle() {
  const ctx = useContext(SidePanelContext);
  if (!ctx) return null;

  const ToggleButton = () => (
    <Button
      depth={2}
      variant="outline"
      size="icon-sm"
      class={cn(
        !isTouchDevice() && 'bg-surface',
        isTouchDevice() &&
          'border-transparent! hover:bg-transparent! active:bg-transparent! focus-visible:bg-transparent! active:text-accent',
        isTouchDevice() && ctx.isOpen() && 'text-accent'
      )}
      tooltip={ctx.isOpen() ? 'Hide Side Panel' : 'Show Side Panel'}
      hotkey={TOKENS.block.toggleSidePanel}
      onClick={() => ctx.toggle()}
    >
      <Show
        when={ctx.isNarrow()}
        fallback={<SidePanelIcon class={cn(ctx.isOpen() && 'text-accent')} />}
      >
        <InfoIcon
          class={cn('size-4', !isMobile() && ctx.isOpen() && 'text-accent')}
        />
      </Show>
    </Button>
  );

  return (
    <Show when={ctx.hasSections()}>
      <SplitHeaderRight>
        <div class="order-last flex items-center">
          <HeaderIsland
            class={cn(
              'size-10 justify-center !px-0',
              ctx.isOpen() && 'text-accent'
            )}
          >
            <ToggleButton />
          </HeaderIsland>
        </div>
      </SplitHeaderRight>
    </Show>
  );
}

function SidePanelOutlet(props: {
  sections: Accessor<SidePanelSectionEntry[]>;
  openIds: Accessor<string[]>;
  setOpenIds: (ids: string[]) => void;
}) {
  // Sort by `order` ascending; sections without an explicit order go after
  // ordered ones, preserving registration order via the stable sort.
  const sortedSections = createMemo(() =>
    [...props.sections()].sort((a, b) => {
      const ao = a.order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.order ?? Number.MAX_SAFE_INTEGER;
      return ao - bo;
    })
  );

  return (
    <Scroll class="flex flex-col min-h-0">
      <Accordion
        multiple
        collapsible
        value={props.openIds()}
        onChange={(value) => props.setOpenIds(value as string[])}
        class="p-2 flex flex-col gap-2 min-h-0"
      >
        <For each={sortedSections()}>{(section) => section.component()}</For>
      </Accordion>
    </Scroll>
  );
}

/**
 * A collapsible section that registers itself with the nearest SidePanel.Layout.
 *
 * The section component returns null in place; its children are rendered
 * inside the side panel's Accordion. Children evaluate lazily when the
 * panel renders the section, so they only mount when the panel is visible.
 *
 * Must be a descendant of `<SidePanel.Layout>`.
 */
function Section(
  props: ParentProps<{
    id: string;
    title: JSX.Element;
    defaultOpen?: boolean;
    /** Render order — lower numbers appear first. */
    order?: number;
    /**
     * Optional controls rendered at the right edge of the header row,
     * outside the collapse trigger — clicking them doesn't toggle the
     * section.
     */
    actions?: JSX.Element;
  }>
) {
  const ctx = useContext(SidePanelContext);
  if (!ctx) {
    throw new Error('<SidePanel.Section> must be inside <SidePanel.Layout>');
  }

  onMount(() => {
    ctx.register({
      id: props.id,
      title: props.title,
      defaultOpen: props.defaultOpen ?? false,
      order: props.order,
      component: () => (
        <Accordion.Item value={props.id}>
          <Panel
            depth={2}
            style={{ height: 'auto' }}
            class="rounded-xl bg-surface"
          >
            <Accordion.Header class="group flex items-center">
              <Accordion.Trigger class="px-2 py-3 flex flex-1 min-w-0 items-center gap-2 text-xs hover:underline">
                <CaretRight class="size-3 text-ink-muted transition-transform duration-90 group-data-expanded:rotate-90" />
                <span>{props.title}</span>
              </Accordion.Trigger>
              <Show when={props.actions}>
                <div class="shrink-0 pr-2">{props.actions}</div>
              </Show>
            </Accordion.Header>
            <Accordion.Content class="group/content overflow-hidden data-expanded:animate-accordion-down data-closed:animate-accordion-up">
              <Suspense fallback={<Loading />}>
                <div class="px-2 pb-2 text-sm opacity-0 group-data-expanded/content:opacity-100 transition-opacity duration-150 ease-out">
                  {props.children}
                </div>
              </Suspense>
            </Accordion.Content>
          </Panel>
        </Accordion.Item>
      ),
    });
    onCleanup(() => ctx.unregister(props.id));
  });
  return null;
}

/** Hook to access the SidePanel context for toggling visibility */
function useSidePanel() {
  const ctx = useContext(SidePanelContext);
  if (!ctx) {
    return null;
  }
  return {
    isOpen: ctx.isOpen,
    setIsOpen: ctx.setIsOpen,
    toggle: ctx.toggle,
    isNarrow: ctx.isNarrow,
    hasSections: ctx.hasSections,
    setOpenSectionIds: ctx.setOpenSectionIds,
    openSectionIds: ctx.openSectionIds,
  };
}

/** Indicates whether the current subtree has a SidePanel.Layout ancestor. */
function _useHasSidePanel(): boolean {
  return useContext(SidePanelContext) !== undefined;
}

/**
 * Two-column label/value grid. The left column width is driven by the
 * `--sidepanel-label-width` CSS variable so multiple grids in the same panel
 * align their labels; rows have a fixed 2rem height for vertical rhythm.
 *
 * Use with `<SidePanel.Row>` children.
 */
function Grid(props: ParentProps<{ class?: string }>) {
  return (
    <div
      class={cn(
        'grid grid-cols-[var(--sidepanel-label-width,auto)_1fr] gap-x-3 items-center text-xs auto-rows-[1.75rem]',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

/**
 * A label/value row inside a `<SidePanel.Grid>`. Renders two siblings into the
 * parent grid: a muted, truncating label on the left and the value on the
 * right.
 */
function Row(props: ParentProps<{ label: JSX.Element }>) {
  return (
    <>
      <span
        class="text-ink-muted truncate self-center"
        title={typeof props.label === 'string' ? props.label : undefined}
      >
        {props.label}
      </span>
      <div class="flex items-center gap-2 min-w-0 self-center">
        {props.children}
      </div>
    </>
  );
}

/**
 * Shared pill className used for value cells in the side panel. Exported as a
 * string so callers can compose it onto their own trigger (e.g. a Property
 * EditTrigger, an anchor, a button) without nesting elements.
 */
const pillClass = cn(
  'inline-flex items-center gap-1.5 min-w-0 max-w-[30ch]',
  'px-2 py-1 leading-tight text-left rounded-full'
);

/** Static pill wrapper. For interactive triggers, use `pillClass` directly. */
function Pill(props: ParentProps<{ class?: string }>) {
  return (
    <div class={cn(pillClass, 'w-fit', props.class)}>{props.children}</div>
  );
}

/** Empty-state indicator used inside value pills. */
function EmptyPill(props: { label?: JSX.Element } = {}) {
  return (
    <span class="inline-flex min-w-0 items-center gap-1.5 opacity-50">
      <Show when={!props.label}>
        <CircleDashedEmpty class="size-3 shrink-0" />
      </Show>
      <Show when={props.label}>
        <span class="truncate">{props.label}</span>
      </Show>
    </span>
  );
}

/**
 * Canonical loading fallback for side panel sections. Sized to roughly match
 * a one-row section so its appearance doesn't shift the panel layout.
 */
function Loading() {
  return (
    <div class="flex items-center justify-center p-2">
      <div class="animate-pulse text-ink-muted rounded-full h-2 w-full bg-skeleton"></div>
    </div>
  );
}

/**
 * Section title with a muted count suffix. Renders `Label (n)` when `count > 0`,
 * otherwise just the label.
 */
function CountTitle(props: { label: JSX.Element; count: number }) {
  return (
    <>
      {props.label}
      <Show when={props.count > 0}>
        {' '}
        <span class="text-ink-extra-muted">({props.count})</span>
      </Show>
    </>
  );
}

function Card(props: ParentProps) {
  return (
    <div class="rounded-lg border border-edge-muted bg-inset overflow-hidden">
      <div class="divide-y divide-edge-muted">{props.children}</div>
    </div>
  );
}

export const SidePanel = {
  Layout,
  Section,
  Grid,
  Row,
  Pill,
  pillClass,
  EmptyPill,
  Loading,
  CountTitle,
  Card,
};
export { useSidePanel };
