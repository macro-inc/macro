import {
  type Appearance,
  duplicateCommand,
  type GraphicsEditor,
  isShape,
  resolveAppearance,
  roots,
  type ShapeKind,
  selectedShapeIds,
} from '@macro-inc/graphics';
import { createGraphicsProjection } from '@macro-inc/graphics/solid';
import { createSignal } from 'solid-js';
import { initialAppearance } from '../core/seed-scene';

export type CanvasTool = 'select' | 'pan' | ShapeKind;
export type CanvasState = ReturnType<typeof createCanvasState>;

export function createCanvasState(editor: GraphicsEditor) {
  const projection = createGraphicsProjection(editor);
  const [tool, setTool] = createSignal<CanvasTool>('select');
  const [defaults, setDefaults] = createSignal(initialAppearance);
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
    editor.cancelShape();
    editor.cancelTransform();
    setTool(next);
  };
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
      editor.select(id);
      setTool('select');
    },
  };
}
