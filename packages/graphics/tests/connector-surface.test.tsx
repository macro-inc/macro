import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { attachConnectorControls } from '../src/browser';
import {
  type ConnectorGesture,
  createConnectorInteraction,
  createGraphicsEditor,
  setConnectorCommand,
  translation,
} from '../src/core';
import { GraphicsSurface } from '../src/solid';

it('creates, reconnects, and cancels endpoint captures with final pointer positions and keyed rendering', () => {
  const editor = createGraphicsEditor(
    ['a', 'b'].map((id, i) => ({
      id,
      type: 'rectangle' as const,
      placement: { parentId: 'scene-root', sortKey: `a${i}` },
      transform: translation(i * 300, 0),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'transparent', stroke: 'black' },
    }))
  );
  const host = document.createElement('div');
  document.body.append(host);
  const [gesture, setGesture] = createSignal<ConnectorGesture>();
  const op = createConnectorInteraction({
    getDocument: () => editor.document,
    commit: (item) => editor.execute(setConnectorCommand, item),
    onChange: () => setGesture(op.getState()),
  });
  let active = true;
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={editor}
        documentPreview={gesture() ? op.getPreviewDocument() : undefined}
        hideSelection={!!gesture()}
        input={{ tool: () => 'select', suspended: () => !!gesture() }}
      />
    ),
    host
  );
  const viewport = host.querySelector<HTMLElement>(
    '[aria-label="Graphics canvas"]'
  )!;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  const detach = attachConnectorControls(viewport, editor, {
    interaction: op,
    active: () => active,
    appearance: () => ({ stroke: 'black', fill: 'transparent' }),
    style: () => ({ route: 'stepped', startHead: 'none', endHead: 'arrow' }),
    createId: () => 'link',
    onCommit: () => {
      active = false;
    },
  });
  const pointer = (target: EventTarget, type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  // Idle hover prepares the first endpoint and never shows other shapes' ports.
  pointer(viewport, 'pointermove', 23, 25);
  expect(op.getTarget()?.targetId).toBe('a');
  expect(op.getTarget()?.active?.anchor).toBe('center');
  pointer(viewport, 'pointerleave', 23, 25);
  expect(op.getTarget()).toBeUndefined();
  pointer(viewport, 'pointermove', 200, 150);
  expect(op.getTarget()).toBeUndefined();
  pointer(viewport, 'pointerdown', 100, 40);
  expect(op.getTarget()?.active?.anchor).toBe('right');
  expect(op.getState()?.dropTarget?.anchor).toBe('right');
  pointer(window, 'pointermove', 250, 70);
  expect(op.getTarget()).toBeUndefined();
  expect(editor.document.items.link).toBeUndefined();
  expect(host.querySelector('[data-graphics-connector-path]')).not.toBeNull();
  // A pointerup beyond the last delivered move still commits the actual release.
  pointer(window, 'pointerup', 300, 40);
  expect(editor.document.items.link).toMatchObject({
    geometry: { end: { binding: { targetId: 'b', anchor: 'left' } } },
  });
  expect(host.querySelectorAll('[data-graphics-connector-end]')).toHaveLength(
    2
  );
  expect(host.querySelector('[data-graphics-handle]')).toBeNull();
  expect(host.querySelector('[data-graphics-selection-bounds]')).toBeNull();
  const node = host.querySelector('[data-graphics-item="link"]'),
    path = node!.querySelector('[data-graphics-connector-path]')!;
  const before = path.getAttribute('d');
  editor.select('b');
  editor.beginTransform('b', { x: 300, y: 0 });
  editor.updateTransform({ x: 340, y: 100 });
  expect(path.getAttribute('d')).not.toBe(before);
  expect(host.querySelector('[data-graphics-item="link"]')).toBe(node);
  editor.commitTransform();
  editor.select('link');
  let end = host.querySelector('[data-graphics-connector-end="end"]')!;
  pointer(end, 'pointerdown', 340, 140);
  pointer(window, 'pointermove', 500, 300);
  expect(host.querySelector('[data-graphics-connector-end]')).toBeNull();
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  expect(op.getState()).toBeUndefined();
  expect(editor.document.items.link).toMatchObject({
    geometry: { end: { binding: { targetId: 'b' } } },
  });
  end = host.querySelector('[data-graphics-connector-end="end"]')!;
  pointer(end, 'pointerdown', 340, 140);
  pointer(window, 'pointerup', 50, 80);
  expect(editor.document.items.link).toMatchObject({
    geometry: { end: { binding: { targetId: 'a', anchor: 'bottom' } } },
  });
  editor.undo();
  expect(editor.document.items.link).toMatchObject({
    geometry: { end: { binding: { targetId: 'b' } } },
  });
  detach();
  dispose();
  host.remove();
  editor.dispose();
});
