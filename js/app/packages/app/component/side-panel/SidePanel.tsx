import { Resize, ResizeZoneContext } from '@core/component/Resize/Resize';
import { TabsInset } from '@core/component/TabsInset';
import { isMobile } from '@core/mobile/isMobile';
import { Accordion } from '@kobalte/core/accordion';
import CaretRight from '@phosphor/caret-right.svg';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import { Layer, Panel, Scroll } from '@ui';
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
import {
  SidePanelContext,
  type SidePanelContextType,
  type SidePanelSectionEntry,
} from './context';

const NARROW_THRESHOLD_PX = 1224;
const SIDE_MIN_PX = 320;
const SIDE_MAX_PX = 380;
const MAIN_MIN_PX = 320;

/**
 * Layout root for a block that opts in to a right-side panel.
 *
 * Wraps `props.children` in a horizontal Resize.Zone with a main panel
 * (the children) and a side panel that hosts any `<SidePanel.Section>`
 * descendants registered via context.
 *
 * Two rendering modes based on available width:
 *   - Wide (>= NARROW_THRESHOLD_PX, non-mobile): side panel renders as a
 *     resizable split next to the main content. Defaults to open.
 *   - Narrow (mobile or narrower than threshold): side panel renders as a
 *     full-screen overlay covering the main content. Defaults to closed;
 *     the main content stays mounted underneath.
 *
 * The side panel is suppressed entirely when no sections are registered.
 *
 * Sections are rendered as a Kobalte Accordion in JSX-declared order.
 */
function Layout(props: ParentProps) {
  const [sections, setSections] = createSignal<SidePanelSectionEntry[]>([]);
  const [openIds, setOpenIds] = createSignal<string[]>([]);
  // Independent open state per mode so wide and narrow can have different
  // defaults (and the user's preference in one mode doesn't bleed into the
  // other after a resize).
  const [isWideOpen, setIsWideOpen] = createSignal(true);
  const [isNarrowOpen, setIsNarrowOpen] = createSignal(false);
  const [isNarrow, setIsNarrow] = createSignal(isMobile());

  const isOpen = () => (isNarrow() ? isNarrowOpen() : isWideOpen());
  const setIsOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const setter = isNarrow() ? setIsNarrowOpen : setIsWideOpen;
    setter(typeof next === 'function' ? next : () => next);
  };
  const toggle = () => setIsOpen((prev) => !prev);

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
  };

  return (
    <SidePanelContext.Provider value={ctx}>
      <Resize.Zone direction="horizontal" gutter={0} resizable={false}>
        <SidePanelLayoutInner
          sections={sections}
          openIds={openIds}
          setOpenIds={setOpenIds}
          isOpen={isOpen}
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
          <SidePanelOutlet
            sections={props.sections}
            openIds={props.openIds}
            setOpenIds={props.setOpenIds}
          />
        </Resize.Panel>
      </Show>
      <Show when={showOverlay()}>
        <div class="absolute inset-0 z-10 flex flex-col bg-surface">
          <Scroll>
            <div class="w-full max-w-2xl mx-auto min-w-0">
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
          <Panel depth={2} style={{ height: 'auto' }} class="rounded-xl">
            <Accordion.Header class="group">
              <Accordion.Trigger class="px-2 py-3 flex w-full items-center gap-2 text-xs hover:underline">
                <CaretRight class="size-3 text-ink-muted transition-transform duration-90 group-data-expanded:rotate-90" />
                <span>{props.title}</span>
              </Accordion.Trigger>
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
  };
}

/**
 * Pill-style tabs that switch between the main content and the side panel
 * overlay in narrow mode. Renders nothing when the layout is wide or when no
 * sections are registered, so it's safe to mount unconditionally.
 */
function NarrowTabs(props: { contentLabel?: string; infoLabel?: string }) {
  const ctx = useContext(SidePanelContext);
  if (!ctx) return null;

  const value = () => (ctx.isOpen() ? 'info' : 'content');

  return (
    <Show when={ctx.isNarrow() && ctx.hasSections()}>
      <TabsInset
        list={[
          { value: 'content', label: props.contentLabel ?? 'Content' },
          { value: 'info', label: props.infoLabel ?? 'Info' },
        ]}
        value={value()}
        onChange={(v) => ctx.setIsOpen(v === 'info')}
      />
    </Show>
  );
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
  'inline-flex items-center gap-1.5 min-w-0 max-w-full',
  'px-2 py-1 leading-tight text-left rounded-full'
);

/** Static pill wrapper. For interactive triggers, use `pillClass` directly. */
function Pill(props: ParentProps<{ class?: string }>) {
  return (
    <div class={cn(pillClass, 'w-fit', props.class)}>{props.children}</div>
  );
}

/** Empty-state indicator used inside value pills. */
function EmptyPill() {
  return <CircleDashedEmpty class="size-3 shrink-0 opacity-50" />;
}

/**
 * Canonical loading fallback for side panel sections. Sized to roughly match
 * a one-row section so its appearance doesn't shift the panel layout.
 */
function Loading() {
  return (
    <div class="flex items-center justify-center p-2">
      <div class="animate-pulse text-ink-muted rounded-full h-2 w-full bg-edge-muted/50"></div>
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
    <Layer depth={1}>
      <div class="rounded-lg border border-edge-muted bg-surface overflow-hidden">
        <div class="divide-y divide-edge-muted">{props.children}</div>
      </div>
    </Layer>
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
  NarrowTabs,
  Card,
};
export { useSidePanel };
