import { afterEach, expect, it } from 'vitest';
import {
  createScene,
  nudgeCommand,
  type ShapeItem,
  setShapeLabelCommand,
  setTextCommand,
  translation,
  validRichText,
} from '../src/core';
import { createGraphicsPeerLab } from '../src/loro';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((fn) => fn()));
const item: ShapeItem<'text'> = {
  id: 'text',
  type: 'text',
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  transform: translation(0, 0),
  appearance: { fill: 'transparent', stroke: 'black' },
  geometry: {
    width: 200,
    height: 32,
    autoWidth: false,
    fontSize: 24,
    fontFamily: 'sans',
    content: 'Original',
  },
};
function setup() {
  const lab = createGraphicsPeerLab(createScene([item]));
  disposers.push(lab.dispose);
  lab.setConnected(false);
  return { lab, a: lab.peers[0]!.editor, b: lab.peers[1]!.editor };
}
it('merges a whole-string edit with a concurrent move and independently undoes each', () => {
  const { lab, a, b } = setup();
  const content = 'Edited';
  a.execute(setTextCommand, {
    ...item,
    geometry: { ...item.geometry, content },
  });
  b.select('text');
  b.execute(nudgeCommand, { x: 50, y: 40 });
  lab.syncNow();
  expect(a.document).toEqual(b.document);
  expect(a.document.items.text).toMatchObject({
    geometry: { content },
    transform: translation(50, 40),
  });
  a.undo();
  lab.syncNow();
  expect(b.document.items.text).toMatchObject({
    geometry: { content: item.geometry.content },
    transform: translation(50, 40),
  });
});
it('concurrent edits choose one complete content string, never combine characters', () => {
  const { lab, a, b } = setup();
  const left = 'Alice complete edit',
    right = 'Bob complete edit';
  a.execute(setTextCommand, {
    ...item,
    geometry: { ...item.geometry, content: left },
  });
  b.execute(setTextCommand, {
    ...item,
    geometry: { ...item.geometry, content: right },
  });
  lab.syncNow();
  expect(a.document).toEqual(b.document);
  const text = a.document.items.text;
  if (text?.type !== 'text') throw Error();
  expect([left, right]).toContain(text.geometry.content);
  expect(validRichText(text.geometry.content)).toBe(true);
});
it('label strings merge independently of moving their owner', () => {
  const label = {
    content: 'Label',
    fontSize: 20,
    fontFamily: 'sans' as const,
    height: 27,
  };
  const shape: ShapeItem<'rectangle'> = {
    ...item,
    type: 'rectangle',
    geometry: { width: 200, height: 100, label },
  };
  const lab = createGraphicsPeerLab(createScene([shape]));
  disposers.push(lab.dispose);
  lab.setConnected(false);
  const a = lab.peers[0]!.editor,
    b = lab.peers[1]!.editor;
  a.execute(setShapeLabelCommand, {
    id: 'text',
    label: { ...label, content: 'Changed' },
  });
  b.select('text');
  b.execute(nudgeCommand, { x: 40, y: 0 });
  lab.syncNow();
  expect(a.document).toEqual(b.document);
  expect(b.document.items.text).toMatchObject({
    geometry: { label: { content: 'Changed' } },
    transform: translation(40, 0),
  });
});

it('adding a new label and moving the previously unlabeled shape both survive', () => {
  const shape: ShapeItem<'rectangle'> = {
    ...item,
    type: 'rectangle',
    geometry: { width: 200, height: 100 },
  };
  const lab = createGraphicsPeerLab(createScene([shape]));
  disposers.push(lab.dispose);
  lab.setConnected(false);
  const a = lab.peers[0]!.editor,
    b = lab.peers[1]!.editor;
  a.execute(setShapeLabelCommand, {
    id: 'text',
    label: {
      content: 'New label',
      fontSize: 24,
      fontFamily: 'sans',
      height: 32,
    },
  });
  b.select('text');
  b.execute(nudgeCommand, { x: 60, y: 0 });
  lab.syncNow();
  expect(a.document).toEqual(b.document);
  expect(b.document.items.text).toMatchObject({
    transform: translation(60, 0),
    geometry: { label: { content: 'New label' } },
  });
});
