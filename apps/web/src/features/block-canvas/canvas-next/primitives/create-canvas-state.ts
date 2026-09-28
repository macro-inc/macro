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
import { createSignal } from 'solid-js';
import { initialAppearance } from '../core/seed-scene';
import { createConnectorState } from './create-connector-state';
import { createEmbedState } from './create-embed-state';
import { createTextState } from './create-text-state';

export type CanvasTool =
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
  const [tool, setTool] = createSignal<CanvasTool>('select');
  const [defaults, setDefaults] = createSignal(initialAppearance);
  const text = createTextState(editor, measureText, defaults);
  const connector = createConnectorState(editor);
  const [notice, setNotice] = createSignal('Ready');
  const selection = () =>
    roots(projection.document, projection.session().selectedIds);
  const shapes = () =>
    selectedShapeIds(projection.document, selection()).flatMap((id) => {
      const item = projection.document.items[id];
      return isShape(item) ? [item] : [];
    });
  function appearanceValue<K extends keyof Appearance>(key: K) {
    const values = shapes().map(
      (shape) => resolveAppearance(shape.appearance)[key]
    );
    if (!values.length) return resolveAppearance(defaults())[key];
    return values.every((value) => value === values[0]) ? values[0] : undefined;
  }
  const chooseTool = (next: CanvasTool) => {
    embeds.exit();
    text.finish();
    connector.interaction.cancel();
    if (next === 'arrow' || next === 'line' || next === 'connector')
      connector.preset(next);
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
  return {
    editor,
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
