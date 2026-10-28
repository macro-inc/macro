import {
  createGraphicsEditorFromBackend,
  createScene,
  translation,
} from '@macro-inc/graphics';
import { createLoroGraphicsBackendFromDoc } from '@macro-inc/graphics/loro';
import { LoroDoc } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { createCanvasSeed } from '../core/collaboration';
import { plainRichText } from '../core/text-codec';
import { createTextState } from './create-text-state';

const dispose: (() => void)[] = [];
afterEach(() =>
  dispose
    .splice(0)
    .reverse()
    .forEach((close) => close())
);
function peers() {
  const scene = createScene([
    {
      id: 'text',
      type: 'text',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(10, 20),
      appearance: { fill: 'transparent', stroke: 'black' },
      geometry: {
        width: 100,
        height: 32,
        fontSize: 24,
        fontFamily: 'sans',
        autoWidth: true,
        content: plainRichText('Before'),
      },
    },
  ]);
  const seed = createCanvasSeed({ version: 2, document: scene });
  const make = () => {
    const doc = new LoroDoc();
    doc.import(seed);
    const backend = createLoroGraphicsBackendFromDoc(doc, scene.rootId);
    const editor = createGraphicsEditorFromBackend(backend);
    dispose.push(() => {
      editor.dispose();
      backend.dispose();
      doc.free();
    });
    const text = createRoot((close) => {
      dispose.push(close);
      return createTextState(
        editor,
        (geometry) => ({ width: geometry.width, height: geometry.height }),
        () => ({ fill: 'transparent', stroke: 'black' })
      );
    });
    return { doc, editor, text };
  };
  return { a: make(), b: make() };
}
it('finishing an unchanged draft preserves a remote text edit', () => {
  const { a, b } = peers();
  a.text.edit('text');
  b.text.edit('text');
  b.text.change(plainRichText('Remote'));
  b.text.finish();
  a.doc.import(b.doc.export({ mode: 'update' }));
  a.text.finish();
  expect(a.editor.document.items.text).toMatchObject({
    geometry: { content: plainRichText('Remote') },
  });
});
it('remote deletion closes a draft without resurrecting the text', () => {
  const { a, b } = peers();
  a.text.edit('text');
  a.text.change(plainRichText('Unsaved'));
  b.editor.select('text');
  b.editor.deleteSelection();
  a.doc.import(b.doc.export({ mode: 'update' }));
  expect(a.text.draft()).toBeUndefined();
  a.text.finish();
  expect(a.editor.document.items.text).toBeUndefined();
});
it('a remote move updates the typing overlay and survives the completed text edit', () => {
  const { a, b } = peers();
  a.text.edit('text');
  a.text.change(plainRichText('Local'));
  b.editor.select('text');
  b.editor.beginTransform('text', { x: 0, y: 0 });
  b.editor.updateTransform({ x: 60, y: 0 });
  b.editor.commitTransform();
  a.doc.import(b.doc.export({ mode: 'update' }));
  expect(a.text.draft()?.transform).toEqual(translation(70, 20));
  a.text.finish();
  expect(a.editor.document.items.text).toMatchObject({
    transform: translation(70, 20),
    geometry: { content: plainRichText('Local') },
  });
});
