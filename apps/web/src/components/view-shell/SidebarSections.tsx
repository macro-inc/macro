import { createDragAutoScroll } from '@app/components/drag-drop/create-drag-auto-scroll';
import {
  createLayoutAnimation,
  type LayoutAnimationItem,
} from '@app/components/drag-drop/create-layout-animation';
import { beginInteraction } from '@app/observability/flow';
import { useUserId } from '@core/context/user';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import {
  type Accessor,
  children,
  createMemo,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
} from 'solid-js';
import { mergeSectionOrder } from './core/section-order';
import { createSectionReorder } from './primitives/create-section-reorder';
import { createSidebarSectionOrder } from './primitives/create-sidebar-section-order';
import { SidebarSectionsContext } from './sidebar-section-context';

/** Reorder resolved section nodes, preserving DOM identity and fixed navigation slots. */
export function SidebarSections(props: {
  view: string;
  viewport: Accessor<HTMLElement | undefined>;
  children: JSX.Element;
}) {
  const userId = useUserId();
  const preference = createSidebarSectionOrder({
    view: () => props.view,
    userId,
  });
  const scope = `sidebar-sections:${createUniqueId()}`;
  let sections: Accessor<LayoutAnimationItem[]> = () => [];
  let pinned: Accessor<string[]> = () => [];
  const keys = () =>
    mergeSectionOrder(
      sections().map(({ key }) => key),
      preference.order()
    );
  const motion = createLayoutAnimation({
    viewport: props.viewport,
    items: () => sections(),
  });
  onCleanup(motion.cancel);
  const reorder = createSectionReorder({
    keys,
    pinned: () => pinned(),
    order: preference.order,
    setOrder: preference.setOrder,
    account: preference.account,
    scope,
    animate: (update) => {
      const interaction = beginInteraction('sidebar.section.reorder', {
        attributes: {
          'sidebar.view': props.view,
          'sidebar.section_count': keys().length,
        },
      });
      const focused = document.activeElement;
      const finish = motion.beginHover();
      try {
        update();
        // Moving a focused DOM node can blur it, although its owner stays mounted.
        if (focused instanceof HTMLElement && focused.isConnected) {
          focused.focus({ preventScroll: true });
        }
      } finally {
        finish();
        interaction.end();
      }
    },
  });
  const [dragState] = useDragDropContext() ?? [];
  createDragAutoScroll({
    getViewport: () => {
      if (dragState?.active.draggable?.data.dndScope === scope) {
        return props.viewport();
      }
    },
    axis: 'y',
  });
  // Resolve children inside the provider so each section receives this controller.
  const renderContent = () => {
    const content = children(() => props.children);
    const sectionNodes = createMemo(() =>
      content.toArray().flatMap((node) => {
        if (!(node instanceof HTMLElement)) return [];
        const key = node.dataset.sidebarSection;
        return key ? [{ key, element: node, layout: node }] : [];
      })
    );
    pinned = () =>
      sectionNodes()
        .filter(
          ({ element }) => element.dataset.sidebarSectionPinned === 'true'
        )
        .map(({ key }) => key);
    sections = () =>
      sectionNodes().filter(
        ({ element }) => element.dataset.sidebarSectionPinned !== 'true'
      );
    const orderedContent = createMemo(() => {
      const byKey = new Map(
        sections().map(({ key, element }) => [key, element])
      );
      let index = 0;
      return content.toArray().map((node) => {
        if (
          !(node instanceof HTMLElement) ||
          !node.dataset.sidebarSection ||
          node.dataset.sidebarSectionPinned === 'true'
        )
          return node;
        return byKey.get(keys()[index++]);
      });
    });
    return <For each={orderedContent()}>{(node) => node}</For>;
  };

  return (
    <SidebarSectionsContext.Provider value={{ reorder }}>
      {renderContent()}
    </SidebarSectionsContext.Provider>
  );
}
