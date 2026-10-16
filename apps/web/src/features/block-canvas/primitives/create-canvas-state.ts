import {
  type Appearance,
  duplicateCommand,
  type GraphicsEditor,
  isShape,
  resolveAppearance,
  roots,
  type ShapeKind,
  selectedShapeIds,
  type TextMeasurer,
} from '@macro-inc/graphics';
import { createGraphicsProjection } from '@macro-inc/graphics/solid';
import { parsePickerColor } from '@ui/utils/color';
import { createMemo, createSignal } from 'solid-js';
import { initialAppearance } from '../core/defaults';
import { createCanvasSnapping } from './create-canvas-snapping';
import { createConnectorState } from './create-connector-state';
import { createEmbedState } from './create-embed-state';
import { createEraserState } from './create-eraser-state';
import { createInspectorPreview } from './create-inspector-preview';
import { createTextState } from './create-text-state';

export type CanvasTool =
  | 'eraser'
  | 'select'
  | 'pan'
  | 'arrow'
  | 'line'
  | Exclude<ShapeKind, 'image' | 'video' | 'document'>;
export type CanvasState = ReturnType<typeof createCanvasState>;

export function createCanvasState(
  editor: GraphicsEditor,
  measureText: TextMeasurer
) {
  const projection = createGraphicsProjection(editor);
  const inspector = createInspectorPreview(editor, measureText);
  const [tool, setTool] = createSignal<CanvasTool>('select');
  const eraser = createEraserState(editor, () => tool() === 'eraser');
  const [defaults, setDefaults] = createSignal(initialAppearance);
  const text = createTextState(editor, measureText, defaults);
  const connector = createConnectorState(editor);
  const [notice, setNotice] = createSignal('Ready');
  const selection = createMemo(
    () => roots(projection.snapshot(), projection.session().selectedIds),
    undefined,
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id, i) => id === b[i]),
    }
  );
  const shapes = createMemo(() =>
    selectedShapeIds(projection.snapshot(), selection()).flatMap((id) => {
      const item = projection.snapshot().items[id];
      return isShape(item) ? [item] : [];
    })
  );
  const canvasColors = createMemo(() => {
    const colors = new Set<string>();
    for (const item of Object.values(projection.document.items)) {
      if (!isShape(item)) continue;
      if (item.type === 'rectangle' || item.type === 'ellipse') {
        colors.add(item.appearance.fill);
      }
      if (
        ['rectangle', 'ellipse', 'connector', 'pencil', 'text'].includes(
          item.type
        )
      ) {
        colors.add(item.appearance.stroke);
      }
    }
    return [...colors].filter(
      (color) => color && color !== 'transparent' && color !== 'none'
    );
  });
  const radiusPreview = createMemo(() => {
    const gesture = projection.session().transform;
    return gesture?.kind === 'radius' ? gesture.nodes : undefined;
  });
  function appearanceValue<K extends keyof Appearance>(key: K) {
    const fallback = resolveAppearance(defaults())[key];
    const values = shapes()
      .filter((shape) => {
        if (key === 'cornerRadius') return shape.type === 'rectangle';
        if (key === 'fill')
          return shape.type === 'rectangle' || shape.type === 'ellipse';
        if (key === 'strokeStyle')
          return ['rectangle', 'ellipse', 'connector'].includes(shape.type);
        if (key === 'strokeWidth')
          return ['rectangle', 'ellipse', 'connector', 'pencil'].includes(
            shape.type
          );
        return true;
      })
      .map((shape) => {
        const preview =
          key === 'cornerRadius' ? radiusPreview()?.[shape.id] : undefined;
        const item = isShape(preview) ? preview : shape;
        return resolveAppearance(item.appearance)[key] ?? fallback;
      });
    if (!values.length) return resolveAppearance(defaults())[key];
    return values.every((value) => value === values[0]) ? values[0] : undefined;
  }
  const chooseTool = (next: CanvasTool) => {
    inspector.cancel();
    eraser.cancel();
    embeds.exit();
    text.finish();
    connector.interaction.cancel();
    if (next === 'arrow' || next === 'line' || next === 'connector')
      connector.preset(next);
    if (['arrow', 'line', 'connector', 'pencil'].includes(next)) {
      // Stroke-only tools cannot inherit an invisible style from filled shapes.
      setDefaults((value) => ({
        ...value,
        stroke:
          !value.stroke.trim() || parsePickerColor(value.stroke)?.a === 0
            ? initialAppearance.stroke
            : value.stroke,
        strokeWidth:
          value.strokeWidth === 0
            ? initialAppearance.strokeWidth
            : value.strokeWidth,
        opacity:
          value.opacity === 0 ? initialAppearance.opacity : value.opacity,
      }));
    }
    editor.cancelShape();
    editor.cancelTransform();
    setTool(next);
  };
  const embeds = createEmbedState(editor, projection.document, () =>
    chooseTool('select')
  );
  const canGroup = () => {
    const nodes = selection().map((id) => projection.document.items[id]);
    const first = nodes[0];
    return (
      nodes.length > 1 &&
      first?.type !== 'surface' &&
      !!first &&
      nodes.every(
        (node) =>
          node?.type !== 'surface' &&
          node?.placement.parentId === first.placement.parentId
      )
    );
  };
  const snapping = createCanvasSnapping(editor, () => {
    inspector.cancel();
    connector.interaction.cancel();
    eraser.cancel();
  });
  return {
    editor,
    ...snapping,
    snapUnit: () => projection.session().snapUnit,
    inspector,
    eraser,
    embeds,
    text,
    connector,
    isConnectorTool: () => ['connector', 'arrow', 'line'].includes(tool()),
    ...projection,
    tool,
    chooseTool,
    defaults,
    notice,
    setNotice,
    selection,
    shapes,
    appearanceValue,
    canvasColors,
    canGroup,
    canUngroup: () =>
      selection().length === 1 &&
      projection.document.items[selection()[0]!]?.type === 'group',
    style(patch: Partial<Appearance>) {
      setDefaults((value) => ({ ...value, ...patch }));
      editor.setSelectionAppearance(patch);
    },
    duplicate: () =>
      editor.execute(duplicateCommand, { createId: () => crypto.randomUUID() }),
    group: () => {
      if (canGroup()) editor.groupSelection(crypto.randomUUID());
    },
    ungroup: () => editor.ungroupSelection(),
    shapeCreated(id: string) {
      if (tool() === 'pencil') return;
      editor.select(id);
      setTool('select');
    },
  };
}
