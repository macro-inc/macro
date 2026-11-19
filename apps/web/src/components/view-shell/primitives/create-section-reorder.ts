import { useDragDropContext } from '@thisbeyond/solid-dnd';
import type { Accessor } from 'solid-js';
import {
  reorderSection,
  replaceVisibleSectionOrder,
  type SectionDropEdge,
  sectionDropEdge,
} from '../core/section-order';

export type SectionReorder<Key extends string = string> = {
  scope: string;
  dropEdge: (key: Key) => SectionDropEdge | undefined;
  move: (key: Key, direction: -1 | 1) => void;
  isDragging: (key: Key) => boolean;
  cancel: () => void;
};

/** Scope drag events and fence completion to the account that began the gesture. */
export function createSectionReorder<Key extends string>(options: {
  keys: Accessor<readonly Key[]>;
  order: Accessor<readonly Key[]>;
  pinned?: Accessor<readonly Key[]>;
  account: Accessor<unknown>;
  scope: string;
  setOrder: (keys: Key[]) => void;
  animate: (update: () => void) => void;
}): SectionReorder<Key> {
  const [state, actions] = useDragDropContext() ?? [];
  let drag: { account: unknown } | undefined;

  const sortableKeys = () => {
    const pinned = new Set(options.pinned?.() ?? []);
    return options.keys().filter((key) => !pinned.has(key));
  };
  const persist = (sections: Key[]) =>
    options.animate(() => {
      const pinned = new Set(options.pinned?.() ?? []);
      options.setOrder(
        replaceVisibleSectionOrder(
          options.order().filter((key) => !pinned.has(key)),
          sections.filter((key) => !pinned.has(key))
        )
      );
    });

  actions?.onDragStart(({ draggable }) => {
    drag = undefined;
    if (
      draggable.data.dndScope === options.scope &&
      sortableKeys().includes(draggable.data.section)
    ) {
      drag = { account: options.account() };
    }
  });
  actions?.onDragEnd(({ draggable, droppable }) => {
    if (
      !drag ||
      drag.account !== options.account() ||
      draggable.data.dndScope !== options.scope ||
      droppable?.data.dndScope !== options.scope
    )
      return;
    const next = reorderSection(
      sortableKeys(),
      draggable.data.section,
      droppable.data.section
    );
    if (next) persist(next);
  });

  return {
    scope: options.scope,
    dropEdge: (key) => {
      const source = state?.active.draggable;
      const target = state?.active.droppable;
      if (
        source?.data.dndScope !== options.scope ||
        target?.data.dndScope !== options.scope ||
        target.data.section !== key
      )
        return;
      return sectionDropEdge(sortableKeys(), source.data.section, key);
    },
    move: (section, direction) => {
      const keys = sortableKeys();
      const from = keys.indexOf(section);
      const target = keys[from + direction];
      if (from < 0 || target === undefined) return;
      const next = reorderSection(keys, section, target);
      if (next) persist(next);
    },
    isDragging: (key) =>
      sortableKeys().includes(key) &&
      state?.active.draggable?.data.dndScope === options.scope &&
      state.active.draggable.data.section === key,
    cancel: () => {
      drag = undefined;
    },
  };
}
