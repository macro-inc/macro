import { afterEach, expect, it, vi } from 'vitest';
import {
  attachCameraControls,
  type GraphicsInputOptions,
} from '../src/browser';
import { createGraphicsEditor, translation } from '../src/core';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup(options: GraphicsInputOptions, embedded = false) {
  const editor = createGraphicsEditor([
    {
      id: 'shape',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'white', stroke: 'black' },
    },
  ]);
  const markdown = document.createElement('div');
  markdown.setAttribute('contenteditable', 'true');
  const card = document.createElement('div');
  if (embedded) card.setAttribute('contenteditable', 'false');
  const viewport = document.createElement('div');
  viewport.tabIndex = 0;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  card.append(viewport);
  markdown.append(card);
  document.body.append(markdown);
  const detach = attachCameraControls(viewport, editor, options);
  cleanups.push(() => {
    detach();
    editor.dispose();
    markdown.remove();
  });
  const pointer = (type: string, x: number, y: number, shiftKey = false) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      shiftKey,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    viewport.dispatchEvent(event);
  };
  return { editor, viewport, pointer };
}

it('pans a non-editable canvas island inside an editable markdown document', () => {
  const { editor, pointer } = setup(
    { editing: false, tool: () => 'pan' },
    true
  );
  const before = editor.getCamera();
  pointer('pointerdown', 10, 10);
  pointer('pointermove', 50, 30);
  pointer('pointerup', 50, 30);
  expect(editor.getCamera()).toEqual({
    ...before,
    x: before.x + 40,
    y: before.y + 20,
  });
});

it('still leaves pointers inside editable text to the text editor', () => {
  const { editor, pointer } = setup({ tool: () => 'pan' });
  const before = editor.getCamera();
  pointer('pointerdown', 10, 10);
  pointer('pointermove', 50, 30);
  pointer('pointerup', 50, 30);
  expect(editor.getCamera()).toEqual(before);
});

it('selects and box-selects without moving or deleting shapes in read-only mode', () => {
  const { editor, viewport, pointer } = setup(
    { editing: false, tool: () => 'select' },
    true
  );
  const before = editor.document;
  pointer('pointerdown', 20, 20);
  pointer('pointermove', 60, 40);
  pointer('pointerup', 60, 40);
  expect(editor.getSession().selectedIds).toEqual(['shape']);
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })
  );
  expect(editor.document).toBe(before);
  pointer('pointerdown', 20, 20, true);
  expect(editor.getSession().selectedIds).toEqual([]);
  pointer('pointerdown', -10, -10);
  pointer('pointermove', 110, 90);
  pointer('pointerup', 110, 90);
  expect(editor.getSession().selectedIds).toEqual(['shape']);
  expect(editor.document).toBe(before);
  expect(editor.getSession().canUndo).toBe(false);
});

it('does not draw even if a drawing tool is supplied in read-only mode', () => {
  const { editor, pointer } = setup(
    { editing: false, tool: () => 'rectangle' },
    true
  );
  const before = editor.document;
  pointer('pointerdown', 150, 150);
  pointer('pointermove', 200, 200);
  pointer('pointerup', 200, 200);
  expect(editor.document).toBe(before);
});
