import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { createGraphicsEditor, translation, worldBounds } from '../src/core';
import { GraphicsSurface } from '../src/solid';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup(mode: 'single' | 'multiple' | 'group' = 'single') {
  const editor = createGraphicsEditor(
    ['a', 'b'].map((id, i) => ({
      id,
      type: 'rectangle' as const,
      placement: { parentId: 'scene-root', sortKey: `a${i}` },
      transform: translation(i * 100, 0),
      geometry: { width: 50, height: 50 },
      appearance: { fill: 'red', stroke: 'black' },
    }))
  );
  editor.select('a');
  if (mode !== 'single') editor.toggleSelection('b');
  if (mode === 'group') editor.groupSelection('group');
  const host = document.createElement('div');
  const outside = document.createElement('div');
  document.body.append(host, outside);
  const dispose = render(
    () => <GraphicsSurface editor={editor} input={{ tool: () => 'select' }} />,
    host
  );
  const viewport = host.querySelector<HTMLElement>(
    '[aria-label="Graphics canvas"]'
  )!;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  // A sibling toolbar/widget must not swallow the active canvas gesture's end.
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    outside.addEventListener(type, (event) => event.stopPropagation());
  }
  cleanups.push(() => {
    dispose();
    editor.dispose();
    host.remove();
    outside.remove();
  });
  return { editor, viewport, outside, dispose };
}

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  id = 1
) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: id });
  target.dispatchEvent(event);
}

it.each(['single', 'multiple', 'group'] as const)(
  'commits a %s move when capture is lost before release, including outside the canvas',
  (mode) => {
    const { editor, viewport, outside } = setup(mode);
    const before = editor.document;
    pointer(viewport, 'pointerdown', 25, 25);
    pointer(viewport, 'pointermove', 45, 55);
    pointer(viewport, 'lostpointercapture', 45, 55);
    expect(editor.getSession().transform?.kind).toBe('move');
    expect(editor.document).toBe(before);
    pointer(outside, 'pointermove', 900, 900, 2);
    pointer(outside, 'pointerup', 900, 900, 2);
    pointer(outside, 'pointercancel', 900, 900, 2);
    expect(editor.getSession().transform?.geometry.x).toBe(20);
    pointer(outside, 'pointermove', 65, 75);
    expect(editor.getSession().transform?.geometry.x).toBe(40);
    pointer(outside, 'pointerup', 75, 85);
    expect(editor.getSession().transform).toBeUndefined();
    expect(worldBounds(editor.document, 'a')).toMatchObject({ x: 50, y: 60 });
    expect(worldBounds(editor.document, 'b').x).toBe(
      mode === 'single' ? 100 : 150
    );
    const committed = editor.document;
    pointer(viewport, 'lostpointercapture', 75, 85);
    pointer(outside, 'pointermove', 125, 135);
    pointer(outside, 'pointerup', 125, 135);
    expect(editor.document).toBe(committed);
    editor.undo();
    expect(editor.document).toEqual(before);
    editor.redo();
    expect(editor.document).toEqual(committed);
  }
);

it.each(['pointercancel', 'escape', 'blur', 'dispose'])(
  'still cancels a move on %s after losing capture',
  (reason) => {
    const { editor, viewport, outside, dispose } = setup();
    const before = editor.document;
    pointer(viewport, 'pointerdown', 25, 25);
    pointer(viewport, 'pointermove', 45, 55);
    pointer(viewport, 'lostpointercapture', 45, 55);
    expect(editor.getSession().transform?.kind).toBe('move');
    if (reason === 'pointercancel') pointer(outside, 'pointercancel', 45, 55);
    else if (reason === 'escape')
      viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else dispose();
    pointer(outside, 'pointermove', 65, 75);
    pointer(outside, 'pointerup', 65, 75);
    expect(editor.getSession().transform).toBeUndefined();
    expect(editor.document).toBe(before);
    expect(editor.getSession().canUndo).toBe(false);
  }
);
