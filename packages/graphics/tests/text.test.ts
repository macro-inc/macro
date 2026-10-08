import { afterEach, expect, it, vi } from 'vitest';
import {
  copyFragment,
  createGraphicsEditor,
  multiply,
  nodeCorners,
  parseFragment,
  pasteCommand,
  rotation,
  type ShapeItem,
  setTextCommand,
  textDefinition,
  translation,
  validRichText,
  worldBounds,
} from '../src/core';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
const text = (content = 'Hello world'): ShapeItem<'text'> => ({
  id: 'text',
  type: 'text',
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  transform: translation(20, 30),
  appearance: { fill: 'transparent', stroke: 'black' },
  geometry: {
    width: 200,
    height: 32.4,
    autoWidth: true,
    fontSize: 24,
    fontFamily: 'sans',
    content,
  },
});
it('stores frozen rich text and copies nested formatting without mutable input', () => {
  const source = JSON.stringify({
    format: 'host-defined',
    blocks: [{ text: 'Title', bold: true }],
  });
  const editor = createGraphicsEditor([text(source)]);
  cleanups.push(editor.dispose);
  const node = editor.document.items.text;
  if (node?.type !== 'text') throw Error();
  expect(Object.isFrozen(node.geometry)).toBe(true);
  expect(typeof node.geometry.content).toBe('string');
  expect(node.geometry.content).toBe(source);
  editor.select('text');
  const fragment = copyFragment(editor.document, ['text'])!;
  editor.execute(pasteCommand, {
    fragment: parseFragment(JSON.stringify(fragment))!,
    createId: () => 'copy',
  });
  const copy = editor.document.items.copy;
  if (copy?.type !== 'text') throw Error();
  expect(copy.geometry.content).toEqual(source);
  expect(copy.transform[4]).toBe(44);
  editor.undo();
  expect(editor.document.items.copy).toBeUndefined();
});
it('stores empty and whitespace content verbatim until the host explicitly deletes it', () => {
  const editor = createGraphicsEditor();
  cleanups.push(editor.dispose);
  editor.execute(setTextCommand, text(''));
  expect(editor.document.items.text).toEqual(text(''));
  expect(editor.getSession().canUndo).toBe(true);
  editor.execute(setTextCommand, text('Edited'));
  editor.execute(setTextCommand, text(' '));
  expect(editor.document.items.text).toEqual(text(' '));
  editor.undo();
  expect(editor.document.items.text).toEqual(text('Edited'));
  editor.select('text');
  editor.deleteSelection();
  expect(editor.document.items.text).toBeUndefined();
  editor.undo();
  expect(editor.document.items.text).toEqual(text('Edited'));
});
it('uses injected measurement for rotated side reflow and keeps the opposite edge fixed', () => {
  const measure = vi.fn((geometry: ShapeItem<'text'>['geometry']) => ({
    width: geometry.width,
    height: 64.8,
  }));
  const item = {
    ...text(),
    transform: multiply(translation(20, 30), rotation(Math.PI / 2)),
  };
  const editor = createGraphicsEditor([item], { measureText: measure });
  cleanups.push(editor.dispose);
  editor.select('text');
  editor.beginTransform('text', { x: 20, y: 230 }, 'e');
  editor.updateTransform({ x: 20, y: 130 });
  const preview = editor.getSession().transform?.nodes.text;
  if (preview?.type !== 'text') throw Error();
  expect(preview.geometry.fontSize).toBe(24);
  expect(preview.geometry.autoWidth).toBe(false);
  expect(preview.geometry.width).toBeCloseTo(100);
  expect(preview.geometry.height).toBeCloseTo(64.8);
  expect(preview.transform).toEqual(item.transform);
  expect(measure).toHaveBeenCalled();
  editor.commitTransform();
  expect(worldBounds(editor.document, 'text').height).toBeCloseTo(100);
  editor.undo();
  expect(editor.document.items.text).toEqual(item);
});
it('scales font size with a corner and flips through zero', () => {
  const editor = createGraphicsEditor([text()]);
  cleanups.push(editor.dispose);
  editor.select('text');
  editor.beginTransform('text', { x: 220, y: 62.4 }, 'se');
  editor.updateTransform({ x: 420, y: 94.8 });
  const preview = editor.getSession().transform?.nodes.text;
  if (preview?.type !== 'text') throw Error();
  expect(preview.geometry.fontSize).toBeCloseTo(48);
  expect(preview.geometry.width).toBeCloseTo(400);
  editor.updateTransform({ x: -180, y: -2.4 });
  editor.commitTransform();
  const item = editor.document.items.text;
  if (item?.type !== 'text') throw Error();
  expect(item.geometry.fontSize).toBeGreaterThan(0);
  expect(item.transform[0]).toBeLessThan(0);
});

it.each([
  'nw',
  'ne',
  'se',
  'sw',
] as const)('shrinks text from %s with horizontal pointer movement and keeps the opposite corner fixed', (handle) => {
  const item = text();
  const editor = createGraphicsEditor([item]);
  cleanups.push(editor.dispose);
  const index = ['nw', 'ne', 'se', 'sw'].indexOf(handle);
  const before = nodeCorners(editor.document, item.id);
  const start = before[index]!;
  editor.select(item.id);
  editor.beginTransform(item.id, start, handle);
  editor.updateTransform({
    x: start.x + (handle.endsWith('w') ? 100 : -100),
    y: start.y,
  });
  editor.commitTransform();
  const next = editor.document.items[item.id];
  if (next?.type !== 'text') throw Error();
  expect(next.geometry.fontSize).toBeGreaterThan(12);
  expect(next.geometry.fontSize).toBeLessThan(13);
  const anchor = (index + 2) % 4;
  const after = nodeCorners(editor.document, item.id)[anchor]!;
  expect(after.x).toBeCloseTo(before[anchor]!.x);
  expect(after.y).toBeCloseTo(before[anchor]!.y);
  editor.undo();
  expect(editor.document.items[item.id]).toEqual(item);
});

it('does not amplify vertical jitter or reflow text during corner scaling, including scaling from center', () => {
  const measure = vi.fn(() => ({ width: 999, height: 999 }));
  const item = text();
  const editor = createGraphicsEditor([item], { measureText: measure });
  cleanups.push(editor.dispose);
  editor.select(item.id);
  editor.beginTransform(item.id, { x: 220, y: 62.4 }, 'se');
  editor.updateTransform({ x: 220, y: 72.4 }, { fromCenter: true });
  editor.commitTransform();
  const next = editor.document.items[item.id];
  if (next?.type !== 'text') throw Error();
  expect(next.geometry.fontSize).toBeGreaterThan(24);
  expect(next.geometry.fontSize).toBeLessThan(25);
  expect(measure).not.toHaveBeenCalled();
  const bounds = worldBounds(editor.document, item.id);
  expect(bounds.x + bounds.width / 2).toBeCloseTo(120);
  expect(bounds.y + bounds.height / 2).toBeCloseTo(46.2);
  expect(next.geometry.width / next.geometry.height).toBeCloseTo(200 / 32.4);
});
it('bounds opaque content without interpreting its format and rejects invalid typography', () => {
  const content = '<img src=x onerror=alert(1)>';
  expect(validRichText(content)).toBe(true);
  expect(validRichText('{not-json')).toBe(true);
  expect(validRichText('')).toBe(true);
  const link = {
    blocks: [
      {
        type: 'paragraph',
        align: 'left',
        children: [{ type: 'link', href: 'javascript:alert(1)', children: [] }],
      },
    ],
  };
  expect(validRichText(link)).toBe(false);
  expect(validRichText('a'.repeat(2_000_001))).toBe(false);
  expect(
    textDefinition.validateGeometry({ ...text().geometry, fontSize: NaN })
  ).toBe(false);
  expect(
    textDefinition.validateGeometry({
      ...text().geometry,
      fontFamily: 'arbitrary-font',
    })
  ).toBe(false);
});

it('scales a mixed text selection uniformly instead of distorting glyphs or mismatching its box', () => {
  const rectangle: ShapeItem<'rectangle'> = {
    id: 'rect',
    type: 'rectangle',
    placement: { parentId: 'scene-root', sortKey: 'a1' },
    transform: translation(20, 100),
    appearance: { fill: 'transparent', stroke: 'black' },
    geometry: { width: 100, height: 50 },
  };
  const editor = createGraphicsEditor([text(), rectangle]);
  cleanups.push(editor.dispose);
  editor.select('text');
  editor.toggleSelection('rect');
  editor.beginTransform('text', { x: 220, y: 90 }, 'e');
  editor.updateTransform({ x: 420, y: 90 });
  const preview = editor.getSession().transform?.nodes.text;
  if (preview?.type !== 'text') throw Error();
  expect(Math.hypot(preview.transform[0], preview.transform[1])).toBeCloseTo(2);
  expect(Math.hypot(preview.transform[2], preview.transform[3])).toBeCloseTo(2);
  expect(preview.geometry.content).toEqual(text().geometry.content);
});
