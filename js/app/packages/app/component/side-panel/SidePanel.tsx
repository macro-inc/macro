import { Resize, ResizeZoneContext } from '@core/component/Resize/Resize';
import { isMobile } from '@core/mobile/isMobile';
import { Accordion } from '@kobalte/core/accordion';
import CaretRight from '@icon/fill/caret-right-fill.svg';
import { Panel } from '@ui';
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
 *   - the layout root is narrower than NARROW_THRESHOLD_PX, OR
 *   - no sections are currently registered.
 *
 * Sections are rendered as a Kobalte Accordion in JSX-declared order.
 */
function Layout(props: ParentProps) {
  const [sections, setSections] = createSignal<SidePanelSectionEntry[]>([]);
  const [openIds, setOpenIds] = createSignal<string[]>([]);

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

  const ctx: SidePanelContextType = { register, unregister, sections };

  return (
    <SidePanelContext.Provider value={ctx}>
      <Resize.Zone direction="horizontal" gutter={2}>
        <SidePanelLayoutInner
          sections={sections}
          openIds={openIds}
          setOpenIds={setOpenIds}
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
  }>
) {
  const resolved = children(() => props.children);
  const zoneCtx = useContext(ResizeZoneContext);
  if (!zoneCtx) {
    throw new Error('SidePanelLayoutInner must be rendered inside Resize.Zone');
  }

  const isNarrow = createMemo(() => zoneCtx.size() < NARROW_THRESHOLD_PX);
  const hasSections = createMemo(() => props.sections().length > 0);
  const hidden = createMemo(() => isMobile() || isNarrow() || !hasSections());

  return (
    <>
      <Resize.Panel id="side-panel-main" minSize={MAIN_MIN_PX} index={0}>
        {resolved()}
      </Resize.Panel>
      <Resize.Panel
        id="side-panel-side"
        minSize={SIDE_MIN_PX}
        maxSize={SIDE_MAX_PX}
        hidden={hidden}
        index={1}
      >
        <SidePanelOutlet
          sections={props.sections}
          openIds={props.openIds}
          setOpenIds={props.setOpenIds}
        />
      </Resize.Panel>
    </>
  );
}

function SidePanelOutlet(props: {
  sections: Accessor<SidePanelSectionEntry[]>;
  openIds: Accessor<string[]>;
  setOpenIds: (ids: string[]) => void;
}) {
  return (
    <div class="size-full p-2 flex flex-col min-h-0">
      <Accordion
        multiple
        collapsible
        value={props.openIds()}
        onChange={(value) => props.setOpenIds(value as string[])}
        class="flex flex-col gap-2 min-h-0"
      >
        <For each={props.sections()}>{(section) => section.component()}</For>
      </Accordion>
    </div>
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
          <Panel depth={2} style={{ height: 'auto' }} class="rounded-lg shadow-md shadow-drop-shadow">
            <Accordion.Header class="group">
                <Accordion.Trigger class="px-2 py-3 flex w-full items-center gap-2 text-xs text-medium hover:underline">
                  <span>{props.title}</span>
                  <CaretRight class="size-2.5 text-ink-extra-muted transition-transform duration-90 group-data-expanded:rotate-90" />
                </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Suspense fallback={<div class="h-4"/>}>
                <div class="px-2 py-3 text-sm">{props.children}</div>
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

/** Indicates whether the current subtree has a SidePanel.Layout ancestor. */
function useHasSidePanel(): boolean {
  return useContext(SidePanelContext) !== undefined;
}

export const SidePanel = { Layout, Section };
export { useHasSidePanel };
