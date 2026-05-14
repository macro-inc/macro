import { Resize, ResizeZoneContext } from '@core/component/Resize/Resize';
import { isMobile } from '@core/mobile/isMobile';
import CaretRight from '@icon/fill/caret-right-fill.svg';
import { Accordion } from '@kobalte/core/accordion';
import { Panel, Scroll } from '@ui';
import {
  type Accessor,
  children,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
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
const SIDE_MAX_PX = 480;
const MAIN_MIN_PX = 320;

/**
 * Layout root for a block that opts in to a right-side panel.
 *
 * Wraps `props.children` in a horizontal Resize.Zone with two panels:
 * a main panel (the children) and a right side panel that hosts any
 * `<SidePanel.Section>` descendants registered via context.
 *
 * The side panel is hidden when:
 *   - on mobile (`isMobile()`),
 *   - the layout root is narrower than NARROW_THRESHOLD_PX,
 *   - no sections are currently registered, OR
 *   - the user has toggled it closed via `ctx.setIsOpen(false)`.
 *
 * Sections are rendered as a Kobalte Accordion in JSX-declared order.
 */
function Layout(props: ParentProps) {
  const [sections, setSections] = createSignal<SidePanelSectionEntry[]>([]);
  const [openIds, setOpenIds] = createSignal<string[]>([]);
  const [isOpen, setIsOpen] = createSignal(true);

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

  const ctx: SidePanelContextType = {
    register,
    unregister,
    sections,
    isOpen,
    setIsOpen,
    toggle,
  };

  return (
    <SidePanelContext.Provider value={ctx}>
      <Resize.Zone direction="horizontal" gutter={0}>
        <SidePanelLayoutInner
          sections={sections}
          openIds={openIds}
          setOpenIds={setOpenIds}
          isOpen={isOpen}
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
  }>
) {
  const resolved = children(() => props.children);
  const zoneCtx = useContext(ResizeZoneContext);
  if (!zoneCtx) {
    throw new Error('SidePanelLayoutInner must be rendered inside Resize.Zone');
  }

  const isNarrow = createMemo(() => zoneCtx.size() < NARROW_THRESHOLD_PX);
  const hasSections = createMemo(() => props.sections().length > 0);

  // Panel should be hidden if: mobile, narrow, no sections, OR user toggled it closed
  const shouldHide = createMemo(
    () => isMobile() || isNarrow() || !hasSections() || !props.isOpen()
  );

  return (
    <>
      <Resize.Panel id="side-panel-main" minSize={MAIN_MIN_PX} index={0}>
        {resolved()}
      </Resize.Panel>
      <Show when={!shouldHide()}>
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
    </>
  );
}

function SidePanelOutlet(props: {
  sections: Accessor<SidePanelSectionEntry[]>;
  openIds: Accessor<string[]>;
  setOpenIds: (ids: string[]) => void;
}) {
  return (
    <Scroll class="flex flex-col min-h-0">
      <Accordion
        multiple
        collapsible
        value={props.openIds()}
        onChange={(value) => props.setOpenIds(value as string[])}
        class="p-2 flex flex-col gap-2 min-h-0"
      >
        <For each={props.sections()}>{(section) => section.component()}</For>
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
    title: string;
    defaultOpen?: boolean;
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
  };
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

export const SidePanel = { Layout, Section, Row };
export { useHasSidePanel, useSidePanel };
