import {
  createGraphicsEditor,
  plainRichText,
  richTextPlainText,
} from '@macro-inc/graphics';
import { afterEach, expect, it } from 'vitest';
import { createTextState } from './create-text-state';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
it('keeps string drafts outside history and flushes the last edit in one canvas operation', () => {
  const editor = createGraphicsEditor();
  cleanups.push(editor.dispose);
  const state = createTextState(
    editor,
    (g) => ({ width: g.width, height: 32.4 }),
    () => ({ fill: 'transparent', stroke: 'black' })
  );
  state.begin({ x: 10, y: 20 });
  const id = state.draft()!.id;
  state.change(plainRichText('First'));
  state.change(plainRichText('Second'));
  expect(editor.getSession().canUndo).toBe(false);
  expect(editor.document.items[id]).toBeUndefined();
  state.setFlush(() => state.change(plainRichText('Last keystroke')));
  state.finish();
  const item = editor.document.items[id];
  expect(
    item?.type === 'text' && richTextPlainText(item.geometry.content)
  ).toBe('Last keystroke');
  editor.undo();
  expect(editor.document.items[id]).toBeUndefined();
});
it('uses a centered Lexical state for labels and clearing it retains the shape', () => {
  const editor = createGraphicsEditor([
    {
      id: 'box',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: [1, 0, 0, 1, 100, 50],
      geometry: { width: 200, height: 120 },
      appearance: { fill: 'transparent', stroke: 'black' },
    },
  ]);
  cleanups.push(editor.dispose);
  const state = createTextState(
    editor,
    (g) => ({ width: g.width, height: 32.4 }),
    () => ({ fill: 'transparent', stroke: 'black' })
  );
  state.edit('box');
  expect(
    JSON.parse(state.draft()!.geometry.content).root.children[0].format
  ).toBe('center');
  const content = plainRichText('Label');
  state.change(content);
  state.finish();
  expect(editor.document.items.box).toMatchObject({
    geometry: { label: { content } },
  });
  state.edit('box');
  state.change(plainRichText());
  state.finish();
  expect(editor.document.items.box).toMatchObject({
    type: 'rectangle',
    geometry: { width: 200, height: 120 },
  });
  expect(editor.getSession().selectedId).toBe('box');
});
it('finishing a text draft preserves an intervening move', () => {
  const editor = createGraphicsEditor();
  cleanups.push(editor.dispose);
  const state = createTextState(
    editor,
    (g) => ({ width: g.width, height: 32.4 }),
    () => ({ fill: 'transparent', stroke: 'black' })
  );
  state.insert(plainRichText('Before'), { x: 10, y: 20 });
  const id = editor.getSession().selectedId!;
  state.edit(id);
  state.change(plainRichText('After'));
  editor.beginTransform(id, { x: 10, y: 20 });
  editor.updateTransform({ x: 110, y: 20 });
  editor.commitTransform();
  state.finish();
  expect(editor.document.items[id]).toMatchObject({
    transform: [1, 0, 0, 1, 110, 20],
  });
});
