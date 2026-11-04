import {
  ARTIFACT_HTML_MAX_LENGTH,
  canLabel,
  createGraphicsEditor,
  type GraphicsDocument,
  insertShapesCommand,
  nextPresentOrder,
  nudgeCommand,
  type ShapeLabel,
  setArtifactCommand,
  setPresentationOrderCommand,
  setShapeLabelCommand,
  setTextCommand,
} from '@macro-inc/graphics';
import type { ArtifactLibraryEdit } from '@macro-inc/graphics/loro';
import { plainRichText } from '@macro-inc/lexical-core/canvas-text';
import { match } from 'ts-pattern';
import { insertCanvasUserMention } from './mentions';
import type { CanvasOp } from './schema';

function replaceOnce(html: string, find: string, replace: string) {
  const first = html.indexOf(find);
  if (first === -1)
    throw new Error('artifactEdit: the text to find is not in the HTML.');
  if (html.indexOf(find, first + 1) !== -1)
    throw new Error(
      'artifactEdit: the text to find appears more than once. Include more surrounding text.'
    );

  const edited = html.slice(0, first) + replace + html.slice(first + find.length);
  if (edited.length > ARTIFACT_HTML_MAX_LENGTH)
    throw new Error(
      `artifactEdit: the HTML would exceed ${ARTIFACT_HTML_MAX_LENGTH} characters.`
    );
  return edited;
}

/** Shared library changes in a batch, committed with its scene change. */
export function artifactLibraryEdits(ops: CanvasOp[]): ArtifactLibraryEdit[] {
  return ops.flatMap((op): ArtifactLibraryEdit[] => {
    if (op.kind === 'defineStyle')
      return [{ kind: 'styles', name: op.name, source: op.css }];
    if (op.kind === 'defineComponent')
      return [{ kind: 'components', name: op.name, source: op.html }];
    return [];
  });
}

function label(
  text: string,
  fontSize = 20,
  fontFamily: ShapeLabel['fontFamily'] = 'sans'
): ShapeLabel {
  return {
    content: plainRichText(text, 'center'),
    fontSize,
    fontFamily,
    // Placeholder for pure command validation. The host measures wrapped text
    // with the real browser renderer before this candidate can be committed.
    height: fontSize * 1.35,
    width: 240,
  };
}

/** Validate a complete snippet on a disposable editor before touching the live peer. */
export function prepareCanvasEdit(
  document: GraphicsDocument,
  ops: CanvasOp[]
): GraphicsDocument {
  const editor = createGraphicsEditor(document);
  try {
    for (const op of ops) {
      const current = editor.document;
      const required =
        'ids' in op
          ? op.ids
          : 'id' in op &&
              !['create', 'connect', 'createArtifact'].includes(op.kind)
            ? [op.id]
            : [];
      // A group's id is new; its members must already exist.
      for (const id of required) {
        if (!current.items[id] || current.items[id].type === 'surface')
          throw new Error(
            `Item ${id} no longer exists or is the surface. Read the canvas again.`
          );
      }
      match(op)
        .with({ kind: 'create' }, (op) => {
          const appearance = {
            fill: op.type === 'text' ? '#171717' : '#ffffff',
            stroke: '#171717',
            ...op.style,
          };
          const geometry = { width: op.width ?? 320, height: op.height ?? 80 };
          editor.execute(insertShapesCommand, [
            {
              point: { x: op.x, y: op.y },
              item:
                op.type === 'text'
                  ? {
                      id: op.id,
                      type: 'text',
                      appearance,
                      geometry: {
                        ...geometry,
                        content: plainRichText(op.text ?? ''),
                        fontSize: op.fontSize ?? 20,
                        fontFamily: op.fontFamily ?? 'sans',
                        autoWidth: false,
                      },
                    }
                  : {
                      id: op.id,
                      type: op.type,
                      appearance,
                      geometry: {
                        ...geometry,
                        ...(op.text === undefined
                          ? {}
                          : {
                              label: label(op.text, op.fontSize, op.fontFamily),
                            }),
                      },
                    },
            },
          ]);
        })
        .with({ kind: 'createArtifact' }, (op) => {
          editor.execute(insertShapesCommand, [
            {
              point: { x: op.x, y: op.y },
              item: {
                id: op.id,
                type: 'artifact',
                appearance: { fill: 'transparent', stroke: 'transparent' },
                geometry: {
                  title: op.title,
                  html: op.html,
                  width: op.width ?? 640,
                  height: op.height ?? 360,
                  designWidth: op.designWidth ?? 1280,
                  designHeight: op.designHeight ?? 720,
                  presentOrder: nextPresentOrder(current),
                },
              },
            },
          ]);
        })
        .with({ kind: 'artifactSource' }, ({ kind: _, id, ...content }) => {
          editor.execute(setArtifactCommand, { id, content });
        })
        .with({ kind: 'artifactEdit' }, (op) => {
          const item = current.items[op.id];
          if (item?.type !== 'artifact')
            throw new Error(`Item ${op.id} is not an artifact.`);

          editor.execute(setArtifactCommand, {
            id: op.id,
            content: {
              html: replaceOnce(item.geometry.html, op.find, op.replace),
            },
          });
        })
        .with({ kind: 'presentOrder' }, (op) => {
          editor.execute(setPresentationOrderCommand, { ids: op.ids });
        })
        // Library entries live beside the scene, not in it.
        .with({ kind: 'defineStyle' }, { kind: 'defineComponent' }, () => {})
        .with({ kind: 'connect' }, (op) => {
          for (const end of [op.start, op.end]) {
            const target = end.binding && current.items[end.binding.targetId];
            if (
              end.binding &&
              (!target ||
                ['surface', 'group', 'connector', 'pencil'].includes(
                  target.type
                ))
            )
              throw new Error(
                'Connector bindings must target an existing eligible shape.'
              );
          }
          editor.execute(insertShapesCommand, [
            {
              point: { x: 0, y: 0 },
              item: {
                id: op.id,
                type: 'connector',
                appearance: { fill: 'none', stroke: '#171717' },
                geometry: {
                  start: op.start,
                  end: op.end,
                  route: op.route,
                  startHead: 'none',
                  endHead: 'arrow',
                  ...(op.text === undefined ? {} : { label: label(op.text) }),
                },
              },
            },
          ]);
        })
        .with({ kind: 'move' }, (op) => {
          editor.select();
          op.ids.forEach(editor.toggleSelection);
          editor.execute(nudgeCommand, { x: op.dx, y: op.dy });
        })
        .with({ kind: 'style' }, (op) => {
          editor.select();
          op.ids.forEach(editor.toggleSelection);
          editor.setSelectionAppearance(op.style);
        })
        .with({ kind: 'text' }, (op) => {
          const item = current.items[op.id];
          if (item.type === 'text') {
            editor.execute(setTextCommand, {
              ...item,
              geometry: { ...item.geometry, content: plainRichText(op.text) },
            });
          } else if (canLabel(item)) {
            editor.execute(setShapeLabelCommand, {
              id: op.id,
              label: op.text
                ? {
                    ...label(op.text),
                    ...item.geometry.label,
                    content: plainRichText(op.text, 'center'),
                  }
                : undefined,
            });
          } else
            throw new Error(
              'Only text items, rectangles, ellipses and connectors accept text.'
            );
        })
        .with({ kind: 'mentionUser' }, (op) => {
          const item = current.items[op.id];
          if (item.type === 'text')
            editor.execute(setTextCommand, {
              ...item,
              geometry: {
                ...item.geometry,
                content: insertCanvasUserMention(
                  item.geometry.content,
                  op.at,
                  op.person
                ),
              },
            });
          else if (canLabel(item)) {
            const existing = item.geometry.label ?? label('');
            editor.execute(setShapeLabelCommand, {
              id: op.id,
              label: {
                ...existing,
                content: insertCanvasUserMention(
                  existing.content,
                  op.at,
                  op.person
                ),
              },
            });
          } else
            throw new Error(
              'Only text items and shape labels accept person mentions.'
            );
        })
        .with({ kind: 'textStyle' }, (op) => {
          const item = current.items[op.id];
          if (item.type === 'text')
            editor.execute(setTextCommand, {
              ...item,
              geometry: {
                ...item.geometry,
                fontSize: op.fontSize ?? item.geometry.fontSize,
                fontFamily: op.fontFamily ?? item.geometry.fontFamily,
              },
            });
          else if (canLabel(item) && item.geometry.label)
            editor.execute(setShapeLabelCommand, {
              id: op.id,
              label: {
                ...item.geometry.label,
                fontSize: op.fontSize ?? item.geometry.label.fontSize,
                fontFamily: op.fontFamily ?? item.geometry.label.fontFamily,
              },
            });
          else
            throw new Error(
              'Text styling requires an existing label or text item.'
            );
        })
        .with({ kind: 'fitText' }, (op) => {
          const item = current.items[op.id];
          if (item.type !== 'text' && !canLabel(item))
            throw new Error(
              'Text fitting requires a labeled shape or text item.'
            );
          if (op.width === undefined) return;
          if (item.type === 'connector') {
            throw new Error(
              'Connector labels use natural width. Set wrapping width on a text item or box instead.'
            );
          } else {
            const next = prepareCanvasEdit(current, [
              {
                kind: 'resize',
                id: op.id,
                width: op.width,
                height: item.geometry.height,
              },
            ]);
            editor.execute(
              { id: 'fit-text-width', apply: () => ({ document: next }) },
              undefined
            );
          }
        })
        .with({ kind: 'resize' }, (op) => {
          const item = current.items[op.id];
          if (
            item.type === 'group' ||
            item.type === 'surface' ||
            item.type === 'connector' ||
            item.type === 'pencil'
          )
            throw new Error('Resize requires a box, text or embedded item.');
          editor.execute(
            {
              id: 'resize',
              apply: () => ({
                document: {
                  ...current,
                  items: {
                    ...current.items,
                    [op.id]: match(item)
                      .with({ type: 'rectangle' }, (item) => ({
                        ...item,
                        geometry: {
                          ...item.geometry,
                          width: op.width,
                          height: op.height,
                        },
                      }))
                      .with({ type: 'ellipse' }, (item) => ({
                        ...item,
                        geometry: {
                          ...item.geometry,
                          width: op.width,
                          height: op.height,
                        },
                      }))
                      .with({ type: 'text' }, (item) => ({
                        ...item,
                        geometry: {
                          ...item.geometry,
                          width: op.width,
                          height: op.height,
                        },
                      }))
                      .with({ type: 'image' }, (item) => ({
                        ...item,
                        geometry: {
                          ...item.geometry,
                          width: op.width,
                          height: op.height,
                        },
                      }))
                      .with({ type: 'video' }, (item) => ({
                        ...item,
                        geometry: {
                          ...item.geometry,
                          width: op.width,
                          height: op.height,
                        },
                      }))
                      .with({ type: 'document' }, (item) => ({
                        ...item,
                        geometry: {
                          ...item.geometry,
                          width: op.width,
                          height: op.height,
                        },
                      }))
                      .with({ type: 'artifact' }, (item) => ({
                        ...item,
                        geometry: {
                          ...item.geometry,
                          width: op.width,
                          height: op.height,
                        },
                      }))
                      .exhaustive(),
                  },
                },
              }),
            },
            undefined
          );
        })
        .with({ kind: 'delete' }, (op) => {
          const containsReference = (id: string): boolean => {
            const item = current.items[id];
            return (
              ['image', 'video', 'document'].includes(item.type) ||
              Object.values(current.items).some(
                (child) =>
                  child.type !== 'surface' &&
                  child.placement.parentId === id &&
                  containsReference(child.id)
              )
            );
          };
          if (op.ids.some(containsReference))
            throw new Error(
              'Delete embedded assets through the Canvas UI so reference bookkeeping is preserved.'
            );
          editor.select();
          op.ids.forEach(editor.toggleSelection);
          editor.deleteSelection();
        })
        .with({ kind: 'group' }, (op) => {
          editor.select();
          op.ids.forEach(editor.toggleSelection);
          editor.groupSelection(op.id);
        })
        .with({ kind: 'ungroup' }, (op) => {
          if (current.items[op.id].type !== 'group')
            throw new Error('Ungroup requires a group.');
          editor.select(op.id);
          editor.ungroupSelection();
        })
        .with({ kind: 'reparent' }, (op) => {
          if (!current.items[op.parentId]) throw new Error('Missing parent.');
          editor.reparent(op.id, op.parentId);
        })
        .with({ kind: 'order' }, (op) => {
          editor.select();
          op.ids.forEach(editor.toggleSelection);
          editor.reorderSelection(op.position);
        })
        .exhaustive();
    }
    if (Object.keys(editor.document.items).length > 5000)
      throw new Error('Canvas AI supports at most 5000 items.');
    return editor.document;
  } finally {
    editor.dispose();
  }
}
