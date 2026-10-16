import { createGraphicsEditor } from '@macro-inc/graphics';
import { afterEach, expect, it } from 'vitest';
import { plainRichText, richTextPlainText } from '../core/text-codec';
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
  const item = editor.document.items.box;
  expect(item?.type === 'rectangle' && item.geometry.label).toBeUndefined();
  editor.undo();
  expect(editor.document.items.box).toMatchObject({
    geometry: { label: { content } },
  });
});

it('abandons empty creations and empty pastes, deletes cleared text, and restores it with undo', () => {
  const editor = createGraphicsEditor();
  cleanups.push(editor.dispose);
  const state = createTextState(
    editor,
    (g) => ({ width: g.width, height: 32.4 }),
    () => ({ fill: 'transparent', stroke: 'black' })
  );
  state.begin({ x: 0, y: 0 });
  state.finish();
  state.insert(plainRichText(' \n '), { x: 0, y: 0 });
  expect(editor.getSession().canUndo).toBe(false);
  state.insert(plainRichText('Keep me'), { x: 0, y: 0 });
  const id = editor.getSession().selectedId!;
  const before = editor.document.items[id];
  state.edit(id);
  state.change(plainRichText(' \n '));
  state.finish();
  expect(editor.document.items[id]).toBeUndefined();
  editor.undo();
  expect(editor.document.items[id]).toEqual(before);
});

it('commits mention-only text and rejects invalid drafts without changing saved content', () => {
  const editor = createGraphicsEditor();
  cleanups.push(editor.dispose);
  const state = createTextState(
    editor,
    (g) => ({ width: g.width, height: 32.4 }),
    () => ({ fill: 'transparent', stroke: 'black' })
  );
  const mention = JSON.parse(plainRichText());
  mention.root.children[0].children = [
    {
      type: 'user-mention',
      version: 1,
      userId: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
    },
  ];
  const content = JSON.stringify(mention);
  state.begin({ x: 0, y: 0 });
  const id = state.draft()!.id;
  state.change(content);
  expect(() => state.change('{broken')).toThrow('Invalid canvas text');
  state.finish();
  expect(editor.document.items[id]).toMatchObject({ geometry: { content } });
  expect(() => state.insert('plain unencoded text', { x: 0, y: 0 })).toThrow(
    'Invalid canvas text'
  );
  expect(editor.document.items[id]).toMatchObject({ geometry: { content } });
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

it('edits connector labels at their visible bound midpoint and clears only the label', () => {
  const editor = createGraphicsEditor([
    {
      id: 'link',
      type: 'connector',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: [1, 0, 0, 1, 0, 0],
      appearance: { stroke: 'black', fill: 'transparent' },
      geometry: {
        start: { point: { x: 0, y: 0 } },
        end: {
          point: { x: 10, y: 0 },
          binding: { targetId: 'target', anchor: 'left' },
        },
        route: 'straight',
        startHead: 'none',
        endHead: 'arrow',
      },
    },
    {
      id: 'target',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: [1, 0, 0, 1, 400, -50],
      appearance: { stroke: 'black', fill: 'transparent' },
      geometry: { width: 100, height: 100 },
    },
  ]);
  cleanups.push(editor.dispose);
  const before = editor.document.items.link;
  const state = createTextState(
    editor,
    () => ({ width: 100, height: 30 }),
    () => ({ stroke: 'black', fill: 'transparent' })
  );
  state.edit('link');
  expect(state.isLabel()).toBe(true);
  expect(state.draft()?.transform).toEqual([1, 0, 0, 1, 150, -15]);
  state.change(plainRichText('Bound label'));
  expect(editor.document.items.link).toEqual(before);
  state.finish();
  const labeled = editor.document.items.link;
  expect(labeled).toMatchObject({
    type: 'connector',
    geometry: {
      label: { width: 100, height: 30 },
      end: { binding: { targetId: 'target' } },
    },
  });
  state.edit('link');
  state.change(plainRichText());
  state.finish();
  expect(editor.document.items.link).toEqual(before);
  editor.undo();
  expect(editor.document.items.link).toEqual(labeled);
});
