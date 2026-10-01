import {
  type Appearance,
  canLabel,
  children,
  type GraphicsCommand,
  type GraphicsEditor,
  type LabelShape,
  measureShapeLabel,
  type Point,
  type RichText,
  type ShapeItem,
  setShapeLabelCommand,
  setTextCommand,
  shapeLabelText,
  snapPoint,
  snapValue,
  sortKeysBetween,
  type TextGeometry,
  type TextMeasurer,
  textDefinition,
  translation,
} from '@macro-inc/graphics';
import { createSignal } from 'solid-js';
import {
  plainRichText,
  richTextPlainText,
  validCanvasText,
} from '../core/text-codec';
import type { CanvasInspectorPreview } from './create-inspector-preview';
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
    if (patch.content !== undefined && !validCanvasText(patch.content))
      throw new Error('Invalid canvas text');
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
    if (current?.kind === 'text') {
      if (richTextPlainText(current.item.geometry.content).trim())
        editor.execute(setTextCommand, current.item);
      else if (editor.document.items[current.item.id]?.type === 'text') {
        editor.select(current.item.id);
        editor.deleteSelection();
      }
    } else if (current) {
      const label = current.item.geometry.label;
      editor.execute(setShapeLabelCommand, {
        id: current.item.id,
        label:
          label && richTextPlainText(label.content).trim() ? label : undefined,
      });
    }
  }
  function createItem(
    point: Point,
    width: number | undefined,
    content: RichText
  ): ShapeItem<'text'> {
    point = snapPoint(point, editor.getSnapUnit());
    if (width !== undefined) width = snapValue(width, editor.getSnapUnit());
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
    if (!validCanvasText(content)) throw new Error('Invalid canvas text');
    finish();
    if (!richTextPlainText(content).trim()) return;
    editor.execute(setTextCommand, createItem(point, width, content));
  }
  function edit(id: string) {
    if (draft()?.id === id) return;
    finish();
    const item = editor.document.items[id];
    if (item?.type !== 'text' && !canLabel(item)) return;
    const content =
      item.type === 'text'
        ? item.geometry.content
        : item.geometry.label?.content;
    if (content !== undefined && !validCanvasText(content)) return;
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
  type TypographyPatch = Partial<
    Pick<TextGeometry, 'fontSize' | 'fontFamily' | 'autoWidth'>
  >;
  const typographyCommand: GraphicsCommand<TypographyPatch> = {
    id: 'canvas.typography',
    apply(context, patch) {
      if (context.selection.length !== 1) return { document: context.document };
      const item = context.document.items[context.selection[0]!];
      if (item?.type === 'text')
        return setTextCommand.apply(context, {
          ...item,
          geometry: resize({ ...item.geometry, ...patch }),
        });
      if (canLabel(item) && item.geometry.label)
        return setShapeLabelCommand.apply(context, {
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
      return { document: context.document };
    },
  };
  function typography(patch: TypographyPatch) {
    setDefaults((value) => ({ ...value, ...patch }));
    if (draft()) {
      update(patch);
      return;
    }
    editor.execute(typographyCommand, patch);
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
    scrubFontSize(preview: CanvasInspectorPreview) {
      const original = editing();
      let last = original;
      return preview.begin(
        (context, fontSize) => {
          if (!original)
            return typographyCommand.apply(context, { fontSize }).document;
          update({ fontSize });
          last = editing();
        },
        (fontSize) => typography({ fontSize }),
        () => {
          if (original && editing() === last) setEditing(original);
        }
      );
    },
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
