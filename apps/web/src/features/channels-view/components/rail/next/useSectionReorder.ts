import { useUserId } from '@core/context/user';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, createMemo } from 'solid-js';
import type { ChannelSectionKey } from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';

/** Reorder this viewer's sections without changing shared label data. */
export function useSectionReorder(
  keys: Accessor<readonly ChannelSectionKey[]>,
  animate: (reorder: () => void) => void
) {
  const rail = useChannelsRail();
  const userId = useUserId();
  const account = createMemo(() => ({ id: userId() }));
  const [state, actions] = useDragDropContext() ?? [];
  const scope = `${rail.railId}:sections`;
  let dragAccount: ReturnType<typeof account> | undefined;

  const dropEdge = (key: ChannelSectionKey) => {
    const source = state?.active.draggable;
    const target = state?.active.droppable;

    if (
      source?.data.dndScope !== scope ||
      target?.data.dndScope !== scope ||
      target.data.section !== key
    ) {
      return;
    }

    const sections = keys();
    const from = sections.indexOf(source.data.section);
    const to = sections.indexOf(key);

    if (from < 0 || to < 0 || from === to) {
      return;
    }

    return from < to ? 'bottom' : 'top';
  };

  actions?.onDragStart(({ draggable }) => {
    if (draggable.data.dndScope === scope) {
      dragAccount = account();
    }
  });

  const persist = (sections: ChannelSectionKey[]) => {
    const visible = new Set(sections);
    const all = [...new Set([...rail.sectionOrder(), ...sections])];
    let index = 0;

    animate(() =>
      rail.setSectionOrder(
        all.map((key) => (visible.has(key) ? sections[index++] : key))
      )
    );
  };

  actions?.onDragEnd(({ draggable, droppable }) => {
    if (
      dragAccount !== account() ||
      draggable.data.dndScope !== scope ||
      droppable?.data.dndScope !== scope
    ) {
      return;
    }

    const sections = [...keys()];
    const from = sections.indexOf(draggable.data.section);
    const to = sections.indexOf(droppable.data.section);

    if (from < 0 || to < 0 || from === to) {
      return;
    }

    sections.splice(to, 0, ...sections.splice(from, 1));
    persist(sections);
  });

  const move = (section: ChannelSectionKey, direction: -1 | 1) => {
    const sections = [...keys()];
    const from = sections.indexOf(section);
    const to = from + direction;

    if (from < 0 || to < 0 || to >= sections.length) {
      return;
    }

    sections.splice(to, 0, ...sections.splice(from, 1));
    persist(sections);
  };

  const isDragging = (key: ChannelSectionKey) =>
    state?.active.draggable?.data.dndScope === scope &&
    state.active.draggable.data.section === key;

  return { scope, dropEdge, move, isDragging };
}
