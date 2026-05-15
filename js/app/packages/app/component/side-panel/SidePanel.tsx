import { Resize, ResizeZoneContext } from '@core/component/Resize/Resize';
import { isMobile } from '@core/mobile/isMobile';
import CaretRight from '@icon/fill/caret-right-fill.svg';
import { Accordion } from '@kobalte/core/accordion';
import { cn, Layer, Panel, Scroll } from '@ui';
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

const NARROW_THRESHOLD_PX = 720;
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
          <SidePanelOutlet
            sections={props.sections}
            openIds={props.openIds}
            setOpenIds={props.setOpenIds}
          />
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
          <Panel
            depth={2}
            style={{ height: 'auto' }}
            class="rounded-lg shadow-md shadow-drop-shadow"
          >
            <Accordion.Header class="group">
              <Accordion.Trigger class="px-2 py-3 flex w-full items-center gap-2 text-sm hover:underline">
                <span>{props.title}</span>
                <CaretRight class="size-2.5 text-ink-extra-muted transition-transform duration-90 group-data-expanded:rotate-90" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content class="group/content overflow-hidden data-expanded:animate-accordion-down data-closed:animate-accordion-up">
              <Suspense fallback={<div class="h-4" />}>
                <div class="px-2 pb-3 text-sm opacity-0 group-data-expanded/content:opacity-100 transition-opacity duration-150 ease-out">
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
  return (
    <Show when={ctx.isNarrow() && ctx.hasSections()}>
      <Layer depth={0}>
        <div class="flex items-center shrink-0 bg-edge-muted p-0.5 rounded-sm">
          <Layer depth={3}>
            <NarrowTab
              active={!ctx.isOpen()}
              label={props.contentLabel ?? 'Content'}
              onClick={() => ctx.setIsOpen(false)}
            />
            <NarrowTab
              active={ctx.isOpen()}
              label={props.infoLabel ?? 'Info'}
              onClick={() => ctx.setIsOpen(true)}
            />
          </Layer>
        </div>
      </Layer>
    </Show>
  );
}

function NarrowTab(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      class={cn(
        'text-xs px-2.5 py-0.5 rounded-xs transition-colors',
        props.active ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink'
      )}
    >
      {props.label}
    </button>
  );
}

/** Indicates whether the current subtree has a SidePanel.Layout ancestor. */
function useHasSidePanel(): boolean {
  return useContext(SidePanelContext) !== undefined;
}

/**
 * A simple flex row for side panel content.
 * Children are rendered on the left, label on the right.
 */
function Row(props: ParentProps<{ label: JSX.Element }>) {
  return (
    <div class="flex flex-row items-center gap-2 text-xs">
      {props.children}
      <span class="text-ink-muted">{props.label}</span>
    </div>
  );
}

export const SidePanel = { Layout, Section, Row, NarrowTabs };
export { useHasSidePanel, useSidePanel };
