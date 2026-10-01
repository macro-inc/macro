import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  createScene,
  IDENTITY,
  multiply,
  type RectangleItem,
  radiusHandlePoint,
  radiusHandles,
  rotation,
  scaling,
  transformPoint,
  translation,
  worldMatrix,
} from '../src/core';
import { createGraphicsPeerLab } from '../src/loro';
import { GraphicsSurface } from '../src/solid';

const rectangle = (radius = 0): RectangleItem => ({
  id: 'rect',
  type: 'rectangle',
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  transform: IDENTITY,
  geometry: { width: 160, height: 100 },
  appearance: { fill: 'transparent', stroke: 'black', cornerRadius: radius },
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()));

it.each(radiusHandles)(
  'drags %s in a rotated, reflected, scaled group with one undo step',
  (handle) => {
    const item = {
      ...rectangle(8),
      placement: { parentId: 'group', sortKey: 'a0' },
      transform: rotation(0.4),
    };
    const editor = createGraphicsEditor(
      [
        {
          id: 'group',
          type: 'group',
          placement: { parentId: 'scene-root', sortKey: 'a0' },
          transform: multiply(translation(100, 200), scaling(-2, 0.5)),
        },
        item,
      ],
      { snapUnit: 4 }
    );
    cleanups.push(editor.dispose);
    const before = editor.document;
    const world = worldMatrix(before, item.id);
    const origin = transformPoint(world, radiusHandlePoint(item, handle));
    const target = transformPoint(
      world,
      radiusHandlePoint(
        { ...item, appearance: { ...item.appearance, cornerRadius: 29.4 } },
        handle
      )
    );
    editor.select(item.id);
    editor.beginTransform(item.id, origin, handle);
    editor.updateTransform(target);
    expect(editor.getSession().transform).toMatchObject({
      kind: 'radius',
      handle,
      nodes: { rect: { appearance: { cornerRadius: 29 } } },
    });
    expect(editor.document).toBe(before);
    expect(editor.getSession().canUndo).toBe(false);
    expect(editor.commitTransform()).toBe(true);
    expect(editor.document.items.rect).toMatchObject({
      transform: item.transform,
      geometry: item.geometry,
      appearance: { cornerRadius: 29 },
    });
    editor.undo();
    expect(editor.document).toEqual(before);
    expect(editor.getSession().canUndo).toBe(false);
    editor.redo();
    expect(editor.document.items.rect).toMatchObject({
      appearance: { cornerRadius: 29 },
    });
  }
);

it.each([undefined, 1, 4, 64])(
  'rounds radius to whole pixels with scene unit %s, including the size limit',
  (snapUnit) => {
    const editor = createGraphicsEditor(
      [{ ...rectangle(), geometry: { width: 160, height: 101 } }],
      { snapUnit }
    );
    cleanups.push(editor.dispose);
    editor.beginTransform('rect', { x: 16, y: 16 }, 'radius-nw');
    editor.updateTransform({ x: 33.7, y: 33.7 });
    expect(editor.getSession().transform?.nodes.rect).toMatchObject({
      appearance: { cornerRadius: 18 },
    });
    editor.updateTransform({ x: 500, y: 500 });
    expect(editor.getSession().transform?.nodes.rect).toMatchObject({
      appearance: { cornerRadius: 50 },
    });
    editor.commitTransform();
    expect(editor.document.items.rect).toMatchObject({
      appearance: { cornerRadius: 50 },
    });
  }
);

it('clamps to the shorter half-side, cancels, and leaves click-only or returned drags out of history', () => {
  const editor = createGraphicsEditor([rectangle(3.5)], { snapUnit: 8 });
  cleanups.push(editor.dispose);
  const before = editor.document;
  const origin = { x: 16, y: 16 };
  editor.beginTransform('rect', origin, 'radius-nw');
  editor.updateTransform(origin);
  expect(editor.commitTransform()).toBe(false);
  editor.beginTransform('rect', origin, 'radius-nw');
  editor.updateTransform({ x: 500, y: 500 });
  expect(editor.getSession().transform?.nodes.rect).toMatchObject({
    appearance: { cornerRadius: 50 },
  });
  editor.updateTransform({ x: -500, y: -500 });
  expect(editor.getSession().transform?.nodes.rect).toMatchObject({
    appearance: { cornerRadius: 0 },
  });
  editor.updateTransform(origin);
  expect(editor.commitTransform()).toBe(false);
  editor.beginTransform('rect', origin, 'radius-nw');
  editor.updateTransform({ x: 30, y: 30 });
  editor.cancelTransform();
  expect(editor.document).toBe(before);
  expect(editor.getSession().canUndo).toBe(false);
  editor.select('rect');
  editor.groupSelection('group');
  expect(editor.beginTransform('group', origin, 'radius-nw')).toBe(false);
});

function setup(radius = 0) {
  const editor = createGraphicsEditor([rectangle(radius)], { snapUnit: 1 });
  editor.select('rect');
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(
    () => <GraphicsSurface editor={editor} input={{ tool: () => 'select' }} />,
    host
  );
  const viewport = host.querySelector<HTMLElement>(
    '[aria-label="Graphics canvas"]'
  )!;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  cleanups.push(() => {
    dispose();
    editor.dispose();
    host.remove();
  });
  const handle = () =>
    host.querySelector('[data-graphics-handle="radius-nw"]')!;
  const drawn = () => host.querySelector('[data-graphics-item="rect"] rect')!;
  return { editor, host, viewport, handle, drawn };
}
function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  shiftKey = false
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    shiftKey,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

it('previews all four corners from an inset handle, stays visible during drag, and commits release outside the viewport', () => {
  const { editor, host, viewport, handle, drawn } = setup();
  const before = editor.document;
  expect(
    host.querySelectorAll('[data-graphics-handle^="radius-"]')
  ).toHaveLength(4);
  pointer(handle(), 'pointerdown', 16, 16, true);
  pointer(viewport, 'pointermove', 46, 46, true);
  expect(editor.getSession().transform?.kind).toBe('radius');
  expect(editor.document).toBe(before);
  expect(drawn().getAttribute('rx')).toBe('30');
  expect(
    host
      .querySelector('[data-graphics-selection-outline="rect"] rect')
      ?.getAttribute('rx')
  ).toBe('30');
  expect(
    host.querySelectorAll('[data-graphics-handle^="radius-"]')
  ).toHaveLength(1);
  expect(handle().querySelector('text')?.textContent).toBe('30');
  pointer(viewport, 'lostpointercapture', 46, 46);
  pointer(document.body, 'pointerup', 56, 56);
  expect(drawn().getAttribute('rx')).toBe('40');
  expect(editor.getSession().transform).toBeUndefined();
  editor.undo();
  expect(drawn().getAttribute('rx')).toBe('0');
  expect(editor.document).toEqual(before);
});

it.each(['Escape', 'pointercancel', 'blur'])(
  'cancels radius preview on %s',
  (reason) => {
    const { editor, viewport, handle, drawn } = setup(8);
    const before = editor.document;
    pointer(handle(), 'pointerdown', 16, 16);
    pointer(viewport, 'pointermove', 40, 40);
    if (reason === 'Escape')
      viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else pointer(viewport, 'pointercancel', 40, 40);
    expect(editor.document).toBe(before);
    expect(editor.getSession().transform).toBeUndefined();
    expect(editor.getSession().canUndo).toBe(false);
    expect(drawn().getAttribute('rx')).toBe('8');
  }
);

it('keeps controls the same screen size at zoom and avoids overlapping handles on pills', () => {
  const { editor, host, handle } = setup(50);
  expect(
    host.querySelectorAll('[data-graphics-handle^="radius-"]')
  ).toHaveLength(2);
  const circles = () =>
    [...handle().querySelectorAll('circle')].map((circle) =>
      circle.getAttribute('r')
    );
  expect(circles()).toEqual(['10', '4']);
  editor.zoomAt({ x: 0, y: 0 }, 4);
  expect(circles()).toEqual(['10', '4']);
  expect(handle().querySelector('circle')?.getAttribute('cx')).toBe('200');
  editor.zoomAt({ x: 0, y: 0 }, 0.1);
  expect(host.querySelector('[data-graphics-handle^="radius-"]')).toBeNull();
});

it('persists a radius drag through the Loro backend and undoes it as one edit', () => {
  const lab = createGraphicsPeerLab(createScene([rectangle()]));
  cleanups.push(lab.dispose);
  lab.setConnected(false);
  const editor = lab.peers[0]!.editor;
  editor.select('rect');
  editor.beginTransform('rect', { x: 16, y: 16 }, 'radius-nw');
  editor.updateTransform({ x: 40, y: 40 });
  expect(lab.status().pending).toBe(0);
  editor.commitTransform();
  lab.syncNow();
  expect(lab.peers[1]!.editor.document.items.rect).toMatchObject({
    appearance: { cornerRadius: 24 },
  });
  editor.undo();
  expect(editor.document.items.rect).toMatchObject({
    appearance: { cornerRadius: 0 },
  });
});
