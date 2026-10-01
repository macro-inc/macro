import { translation } from './affine';
import type { GraphicsCommand } from './commands';
import type { Point, ShapeItem } from './model';
import { sortKeysBetween } from './ordering';
import { children } from './scene';
import { snapPoint } from './snapping';

type NewShape = {
  [K in ShapeItem['type']]: Pick<
    ShapeItem<K>,
    'id' | 'type' | 'geometry' | 'appearance'
  >;
}[ShapeItem['type']];
/** Insert a batch as one history entry, assigning durable sibling order in core. */
export const insertShapesCommand: GraphicsCommand<
  readonly { item: NewShape; point: Point }[]
> = {
  id: 'insert-shapes',
  apply: ({ document, snapUnit }, entries) => {
    if (!entries.length) return { document };
    const siblings = children(document),
      last = document.items[siblings[siblings.length - 1]!];
    const keys = sortKeysBetween(
      last && last.type !== 'surface' ? last.placement.sortKey : null,
      null,
      entries.length
    );
    const items = { ...document.items };
    entries.forEach(({ item, point }, index) => {
      if (items[item.id]) throw new Error('Shape id already exists');
      const position = snapPoint(point, snapUnit);
      items[item.id] = {
        ...item,
        placement: { parentId: document.rootId, sortKey: keys[index]! },
        transform: translation(position.x, position.y),
      };
    });
    return {
      document: { ...document, items },
      selection: entries.map(({ item }) => item.id),
    };
  },
};
