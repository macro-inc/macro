import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { createGraphicsEditor, translation, worldBounds } from '../src/core';
import { GraphicsSurface } from '../src/solid';

it.each([false, true])(
  'moves the entire selection from its unpainted interior with multiple=%s',
  (multiple) => {
    const editor = createGraphicsEditor(
      ['a', 'b', 'c'].map((id, i) => ({
        id,
        type: 'rectangle' as const,
        placement: { parentId: 'scene-root', sortKey: `a${i}` },
        transform: translation(i === 2 ? 65 : i * 100, i === 2 ? 10 : 0),
        geometry: { width: i === 2 ? 20 : 50, height: i === 2 ? 20 : 50 },
        appearance: { fill: i === 2 ? 'red' : 'transparent', stroke: 'black' },
      }))
    );
    editor.zoomAt({ x: 0, y: 0 }, 2);
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(
      () => (
        <GraphicsSurface editor={editor} input={{ tool: () => 'select' }} />
      ),
      host
    );
    const viewport = host.querySelector<HTMLElement>(
      '[aria-label="Graphics canvas"]'
    )!;
    viewport.setPointerCapture = vi.fn();
    viewport.hasPointerCapture = () => false;
    editor.select('a');
    if (multiple) editor.toggleSelection('b');
    const before = editor.document;
    const box = host.querySelector<SVGElement>(
      '[data-graphics-selection-bounds]'
    )!;
    expect(box.style.pointerEvents).toBe('all');
    const pointer = (
      target: Element,
      type: string,
      x: number,
      y: number,
      shiftKey = false
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        shiftKey,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      target.dispatchEvent(event);
    };
    // The multiple-selection point hits an unselected item in the gap. The box
    // still wins; a single empty shape's center is also draggable when selected.
    const x = multiple ? 150 : 50;
    pointer(box, 'pointerdown', x, 40);
    expect(editor.getSession().transform?.kind).toBe('move');
    expect(viewport.style.cursor).toBe('move');
    pointer(viewport, 'pointermove', x + 20, 70);
    expect(host.querySelector('[data-graphics-selection-bounds]')).toBeNull();
    pointer(viewport, 'pointerup', x + 20, 70);
    expect(worldBounds(editor.document, 'a')).toMatchObject({ x: 10, y: 15 });
    expect(worldBounds(editor.document, 'b').x).toBe(multiple ? 110 : 100);
    expect(editor.document.items.c).toEqual(before.items.c);
    editor.undo();
    expect(editor.document).toBe(before);
    expect(editor.getSession().canUndo).toBe(false);
    if (multiple) {
      const nextBox = host.querySelector('[data-graphics-selection-bounds]')!;
      pointer(nextBox, 'pointerdown', 150, 40, true);
      expect(editor.getSession().selectedIds).toEqual(['a', 'b', 'c']);
      expect(editor.getSession().transform).toBeUndefined();
    }
    dispose();
    host.remove();
    editor.dispose();
  }
);
