import type { GraphicsCommand } from './commands';
import type { ShapeItem } from './model';
import { richTextPlainText } from './rich-text';
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
    const empty = !richTextPlainText(item.geometry.content).trim();
    if (
      (!before && empty) ||
      (before?.type === 'text' && textDefinition.sameGeometry(before, item))
    )
      return { document };
    const items = { ...document.items };
    if (empty) delete items[item.id];
    else
      items[item.id] =
        before?.type === 'text' ? { ...before, geometry: item.geometry } : item;
    return {
      document: { ...document, items },
      selection: empty ? [] : [item.id],
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
    const next =
      label && richTextPlainText(label.content).trim() ? label : undefined;
    if (JSON.stringify(item.geometry.label) === JSON.stringify(next))
      return { document };
    const { label: _previous, ...size } = item.geometry;
    return {
      document: {
        ...document,
        items: {
          ...document.items,
          [id]: {
            ...item,
            geometry: { ...size, ...(next ? { label: next } : {}) },
          },
        },
      },
      selection: [id],
    };
  },
};
