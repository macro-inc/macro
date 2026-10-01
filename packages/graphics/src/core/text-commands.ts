import type { GraphicsCommand } from './commands';
import type { ShapeItem } from './model';
import { canLabel, type ShapeLabel, validShapeLabel } from './shapes/label';
import { textDefinition } from './shapes/text';
/** One completed text edit is one document operation; keystrokes stay in the host. */
export const setTextCommand: GraphicsCommand<ShapeItem<'text'>> = {
  id: 'set-text',
  apply: ({ document }, item) => {
    const before = document.items[item.id];
    if (before && before.type !== 'text')
      throw new Error('Text id belongs to another shape');
    if (!textDefinition.validateGeometry(item.geometry))
      throw new Error('Invalid text geometry');
    if (before?.type === 'text' && textDefinition.sameGeometry(before, item))
      return { document };
    const items = { ...document.items };
    items[item.id] =
      before?.type === 'text' ? { ...before, geometry: item.geometry } : item;
    return {
      document: { ...document, items },
      selection: [item.id],
    };
  },
};

/** Clearing a label retains its owning shape and its place in the scene. */
export const setShapeLabelCommand: GraphicsCommand<{
  id: string;
  label?: ShapeLabel;
}> = {
  id: 'set-shape-label',
  apply: ({ document }, { id, label }) => {
    const item = document.items[id];
    if (!canLabel(item)) return { document };
    if (label && !validShapeLabel(label))
      throw new Error('Invalid shape label');
    if (JSON.stringify(item.geometry.label) === JSON.stringify(label))
      return { document };
    const { label: _previous, ...size } = item.geometry;
    return {
      document: {
        ...document,
        items: {
          ...document.items,
          [id]: {
            ...item,
            geometry: { ...size, ...(label ? { label } : {}) },
          },
        },
      },
      selection: [id],
    };
  },
};
