import {
  around,
  enclosing,
  type GraphicsCommand,
  type GraphicsDocument,
  inverse,
  layoutBounds,
  layoutRoots,
  multiply,
  regenerateScaledShapes,
  rotation,
  scaling,
  selectionFrame,
  snapValue,
  stretchShapes,
  translation,
  worldMatrix,
} from '@macro-inc/graphics';

export type LayoutField =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'rotation'
  | 'gapX'
  | 'gapY';
export function layoutEntries(
  document: GraphicsDocument,
  selection: readonly string[]
) {
  return layoutRoots(document, selection).map((id) => {
    const matrix = worldMatrix(document, id);
    return {
      id,
      ...layoutBounds(document, id),
      rotation:
        ((((Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI) % 360) + 360) %
        360,
    };
  });
}
export function layoutValue(
  document: GraphicsDocument,
  selection: readonly string[],
  field: LayoutField
) {
  return entryValue(layoutEntries(document, selection), field);
}
function entryValue(
  entries: ReturnType<typeof layoutEntries>,
  field: LayoutField
) {
  let values: number[];
  if (field === 'gapX' || field === 'gapY') {
    const axis = field === 'gapX' ? 'x' : 'y';
    const size = field === 'gapX' ? 'width' : 'height';
    const sorted = [...entries].sort((a, b) => a[axis] - b[axis]);
    values = sorted
      .slice(1)
      .map((entry, i) => entry[axis] - sorted[i]![axis] - sorted[i]![size]);
  } else values = entries.map((entry) => entry[field]);
  return values.length &&
    values.every((value) => Math.abs(value - values[0]!) < 0.01)
    ? Math.round(values[0]! * 100) / 100
    : undefined;
}
export function selectionLayoutInfo(
  document: GraphicsDocument,
  selection: readonly string[]
) {
  const entries = layoutEntries(document, selection);
  return {
    count: entries.length,
    values: {
      x: entryValue(entries, 'x'),
      y: entryValue(entries, 'y'),
      width: entryValue(entries, 'width'),
      height: entryValue(entries, 'height'),
      rotation: entryValue(entries, 'rotation'),
      gapX: entryValue(entries, 'gapX'),
      gapY: entryValue(entries, 'gapY'),
    },
  };
}
export const selectionLayoutCommand: GraphicsCommand<{
  field: LayoutField | 'flipX' | 'flipY' | 'rotate90';
  value?: number;
  lockAspectRatio?: boolean;
}> = {
  id: 'canvas.selection-layout',
  apply: (
    { document, selection, snapUnit, measureText },
    { field, value = 0, lockAspectRatio = false }
  ) => {
    if (!Number.isFinite(value)) return { document };
    if (isInvalidDimension()) return { document };
    snapLayoutValue();
    const entries = layoutEntries(document, selection);
    if (!entries.length) return { document };
    const items = { ...document.items };
    const bounds = enclosing(
      entries.flatMap((e) => [
        { x: e.x, y: e.y },
        { x: e.x + e.width, y: e.y + e.height },
      ])
    );
    const pivot = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const gap = field === 'gapX' || field === 'gapY';
    const axis = field === 'gapY' ? 'y' : 'x';
    if (gap) entries.sort((a, b) => a[axis] - b[axis]);
    let position = entries[0]![axis];
    const applyLayoutEntry = (entry: (typeof entries)[number]) => {
      const item = items[entry.id];
      if (!item || item.type === 'surface') return;
      let delta = translation(0, 0);
      delta = translateToPosition(delta, entry);
      if (field === 'width' || field === 'height') {
        if (value <= 0 || entry[field] <= 0) return;
        const world = worldMatrix(document, entry.id);
        const aligned = isAxisAlignedTransform(world);
        // World-bound edits cannot deform rotated axes without shearing text.
        // Match the canvas's uniform fallback for incompatible group axes.
        const proportional = requiresProportionalScale(item, entry, aligned);
        const ratio = value / entry[field];
        const scale = dimensionScale(proportional, ratio);
        delta = around({ x: entry.x, y: entry.y }, scaling(scale.x, scale.y));
        if (item.type !== 'group' || !proportional) {
          Object.assign(
            items,
            stretchShapes(
              document,
              [entry.id],
              delta,
              measureText,
              field === 'width' ? 'e' : 's'
            )
          );
          return;
        }
      }
      if (field === 'rotation')
        delta = around(
          { x: entry.x + entry.width / 2, y: entry.y + entry.height / 2 },
          rotation(((value - entry.rotation) * Math.PI) / 180)
        );
      if (field === 'rotate90') delta = around(pivot, rotation(Math.PI / 2));
      delta = applyFlip(delta);
      delta = applyGap(delta, entry);
      const parent = worldMatrix(document, item.placement.parentId);
      items[entry.id] = {
        ...item,
        transform: multiply(
          inverse(parent),
          multiply(delta, worldMatrix(document, entry.id))
        ),
      };
      regenerateResizedShapes(entry);
    };
    for (const entry of entries) {
      applyLayoutEntry(entry);
    }
    return { document: { ...document, items } };

    function regenerateResizedShapes(entry: {
      rotation: number;
      x: number;
      y: number;
      width: number;
      height: number;
      id: string;
    }) {
      if (field === 'width' || field === 'height')
        regenerateScaledShapes(document, [entry.id], items);
    }

    function isInvalidDimension() {
      return (field === 'width' || field === 'height') && value <= 0;
    }

    function dimensionScale(proportional: boolean, ratio: number) {
      return {
        x: proportional || field === 'width' ? ratio : 1,
        y: proportional || field === 'height' ? ratio : 1,
      };
    }

    function isAxisAlignedTransform(world: ReturnType<typeof translation>) {
      return (
        (Math.abs(world[1]) < 1e-8 && Math.abs(world[2]) < 1e-8) ||
        (Math.abs(world[0]) < 1e-8 && Math.abs(world[3]) < 1e-8)
      );
    }

    function applyGap(
      delta: ReturnType<typeof translation>,
      entry: {
        rotation: number;
        x: number;
        y: number;
        width: number;
        height: number;
        id: string;
      }
    ) {
      if (gap) {
        delta = translation(
          axis === 'x' ? position - entry.x : 0,
          axis === 'y' ? position - entry.y : 0
        );
        position += entry[axis === 'x' ? 'width' : 'height'] + value;
      }
      return delta;
    }

    function applyFlip(delta: ReturnType<typeof translation>) {
      if (field === 'flipX' || field === 'flipY')
        delta = around(
          pivot,
          scaling(field === 'flipX' ? -1 : 1, field === 'flipY' ? -1 : 1)
        );
      return delta;
    }

    function translateToPosition(
      delta: ReturnType<typeof translation>,
      entry: {
        rotation: number;
        x: number;
        y: number;
        width: number;
        height: number;
        id: string;
      }
    ) {
      if (field === 'x' || field === 'y')
        delta = translation(
          field === 'x' ? value - entry.x : 0,
          field === 'y' ? value - entry.y : 0
        );
      return delta;
    }

    function requiresProportionalScale(
      item: GraphicsDocument['items'][string],
      entry: {
        rotation: number;
        x: number;
        y: number;
        width: number;
        height: number;
        id: string;
      },
      aligned: boolean
    ) {
      return (
        lockAspectRatio ||
        (item.type === 'text' && field === 'height') ||
        (item.type === 'group'
          ? !selectionFrame(document, [entry.id])?.canDeform
          : !aligned)
      );
    }

    function snapLayoutValue() {
      if (
        field === 'x' ||
        field === 'y' ||
        field === 'width' ||
        field === 'height' ||
        field === 'gapX' ||
        field === 'gapY'
      ) {
        value = snapValue(value, snapUnit);
        if ((field === 'width' || field === 'height') && snapUnit !== undefined)
          value = Math.max(snapUnit, value);
      }
    }
  },
};
