import {
  type Appearance,
  canLabel,
  children,
  type GraphicsEditor,
  type LabelShape,
  measureShapeLabel,
  type Point,
  plainRichText,
  type RichText,
  type ShapeItem,
  setShapeLabelCommand,
  setTextCommand,
  shapeLabelText,
  sortKeysBetween,
  type TextGeometry,
  type TextMeasurer,
  textDefinition,
  translation,
} from '@macro-inc/graphics';
import { createSignal } from 'solid-js';
export function createTextState(
  editor: GraphicsEditor,
  measure: TextMeasurer,
  appearance: () => Appearance
) {
  type TextDraft =
    | { kind: 'text'; item: ShapeItem<'text'> }
    | { kind: 'label'; item: LabelShape };
  const [editing, setEditing] = createSignal<TextDraft>();
  const draft = () => {
    const current = editing();
    return current?.kind === 'label'
      ? shapeLabelText(current.item)
      : current?.item;
  };
  const isLabel = () => editing()?.kind === 'label';
  const [defaults, setDefaults] = createSignal<
    Pick<TextGeometry, 'fontSize' | 'fontFamily' | 'autoWidth'>
  >({ fontSize: 24, fontFamily: 'sans', autoWidth: true });
  let flush: (() => void) | undefined;
  const resize = (geometry: TextGeometry) =>
    textDefinition.freezeGeometry({ ...geometry, ...measure(geometry) });
  function update(patch: Partial<TextGeometry>) {
    setEditing((current) => {
      if (!current) return;
      if (current.kind === 'text')
        return {
          ...current,
          item: {
            ...current.item,
            geometry: resize({ ...current.item.geometry, ...patch }),
          },
        };
      const item = current.item,
        before = item.geometry.label!;
      const label = measureShapeLabel(
        item,
        {
          ...before,
          content: patch.content ?? before.content,
          fontSize: patch.fontSize ?? before.fontSize,
          fontFamily: patch.fontFamily ?? before.fontFamily,
        },
        measure
      );
      return {
        ...current,
        item: { ...item, geometry: { ...item.geometry, label } },
      };
    });
  }
  function finish() {
    flush?.();
    const current = editing();
    setEditing(undefined);
    flush = undefined;
    if (current?.kind === 'text') editor.execute(setTextCommand, current.item);
    else if (current)
      editor.execute(setShapeLabelCommand, {
        id: current.item.id,
        label: current.item.geometry.label,
      });
  }
  function createItem(
    point: Point,
    width: number | undefined,
    content: RichText
  ): ShapeItem<'text'> {
    const document = editor.document,
      ids = children(document),
      last = document.items[ids[ids.length - 1]!];
    return {
      id: crypto.randomUUID(),
      type: 'text',
      placement: {
        parentId: document.rootId,
        sortKey: sortKeysBetween(
          last && last.type !== 'surface' ? last.placement.sortKey : null,
          null,
          1
        )[0]!,
      },
      transform: translation(point.x, point.y),
      appearance: { ...appearance(), fill: 'transparent' },
      geometry: resize({
        content,
        ...defaults(),
        autoWidth: width === undefined ? defaults().autoWidth : false,
        width: Math.max(40, width ?? 320),
        height: 32,
      }),
    };
  }
  function begin(point: Point, width?: number) {
    finish();
    editor.select();
    setEditing({
      kind: 'text',
      item: createItem(point, width, plainRichText()),
    });
  }
  function insert(content: RichText, point: Point, width = 400) {
    finish();
    editor.execute(setTextCommand, createItem(point, width, content));
  }
  function edit(id: string) {
    if (draft()?.id === id) return;
    finish();
    const item = editor.document.items[id];
    if (item?.type !== 'text' && !canLabel(item)) return;
    editor.select(id);
    if (item.type === 'text') setEditing({ kind: 'text', item });
    else {
      const content = plainRichText('', 'center');
      const label =
        item.geometry.label ??
        measureShapeLabel(
          item,
          {
            content,
            fontSize: defaults().fontSize,
            fontFamily: defaults().fontFamily,
            height: defaults().fontSize * 1.35,
          },
          measure
        );
      setEditing({
        kind: 'label',
        item: { ...item, geometry: { ...item.geometry, label } },
      });
    }
  }
  function typography(
    patch: Partial<Pick<TextGeometry, 'fontSize' | 'fontFamily' | 'autoWidth'>>
  ) {
    setDefaults((value) => ({ ...value, ...patch }));
    if (draft()) {
      update(patch);
      return;
    }
    const selected = editor.getSession().selectedId;
    const item = selected ? editor.document.items[selected] : undefined;
    if (item?.type === 'text')
      editor.execute(setTextCommand, {
        ...item,
        geometry: resize({ ...item.geometry, ...patch }),
      });
    else if (canLabel(item) && item.geometry.label)
      editor.execute(setShapeLabelCommand, {
        id: item.id,
        label: measureShapeLabel(
          item,
          {
            ...item.geometry.label,
            fontSize: patch.fontSize ?? item.geometry.label.fontSize,
            fontFamily: patch.fontFamily ?? item.geometry.label.fontFamily,
          },
          measure
        ),
      });
  }
  return {
    draft,
    isLabel,
    defaults,
    begin,
    insert,
    edit,
    update,
    finish,
    typography,
    setFlush: (next: (() => void) | undefined) => {
      flush = next;
    },
    change: (content: RichText) => update({ content }),
    cancel: () => {
      setEditing(undefined);
      flush = undefined;
    },
  };
}
export type CanvasTextState = ReturnType<typeof createTextState>;
