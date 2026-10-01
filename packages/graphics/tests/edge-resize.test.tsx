import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  createScene,
  isShape,
  multiply,
  type Point,
  type ResizeEdge,
  rotation,
  scaling,
  selectionFrame,
  transformPoint,
  translation,
  worldBounds,
  worldMatrix,
} from '../src/core';
import { resizeBounds } from '../src/core/resize';
import { createGraphicsPeerLab } from '../src/loro';
import { GraphicsSurface } from '../src/solid';

const edges: readonly ResizeEdge[] = ['n', 'e', 's', 'w'];
const seed = () =>
  createScene([
    {
      id: 'a',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(20, 30),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'ellipse',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(220, 150),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
  ]);
const closePoint = (actual: Point, expected: Point) => {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
};

it.each(edges)(
  'resizes a rotated single shape from %s while keeping the opposite midpoint fixed',
  (handle) => {
    const base = seed();
    const a = base.items.a!;
    if (!isShape(a)) throw new Error('Missing shape');
    const editor = createGraphicsEditor({
      ...base,
      items: {
        ...base.items,
        a: {
          ...a,
          transform: multiply(
            translation(60, 90),
            multiply(rotation(0.7), scaling(1.4, 0.6))
          ),
        },
      },
    });
    const before = editor.document,
      world = worldMatrix(before, 'a');
    const horizontal = handle === 'e' || handle === 'w',
      negative = handle === 'w' || handle === 'n';
    const origin = horizontal
      ? { x: negative ? 0 : 100, y: 40 }
      : { x: 50, y: negative ? 0 : 80 };
    const fixed = horizontal
      ? { x: negative ? 100 : 0, y: 40 }
      : { x: 50, y: negative ? 80 : 0 };
    editor.beginTransform('a', transformPoint(world, origin), handle);
    // Motion perpendicular to the active axis must not change the other size.
    const delta = negative ? -25 : 25;
    editor.updateTransform(
      transformPoint(world, {
        x: origin.x + (horizontal ? delta : 61),
        y: origin.y + (horizontal ? 61 : delta),
      })
    );
    const nodes = editor.getSession().transform!.nodes;
    const preview = nodes.a;
    if (
      !isShape(preview) ||
      preview.type === 'pencil' ||
      preview.type === 'connector'
    )
      throw new Error('Missing preview');
    expect(preview.geometry.width).toBeCloseTo(horizontal ? 125 : 100, 8);
    expect(preview.geometry.height).toBeCloseTo(horizontal ? 80 : 105, 8);
    const nextFixed = horizontal
      ? { x: negative ? 125 : 0, y: 40 }
      : { x: 50, y: negative ? 105 : 0 };
    closePoint(
      transformPoint(worldMatrix(before, 'a', nodes), nextFixed),
      transformPoint(world, fixed)
    );
    editor.commitTransform();
    editor.undo();
    expect(editor.document).toEqual(before);
  }
);

it.each(edges)(
  'stretches multi-selection from %s on only its active axis and commits once',
  (handle) => {
    const editor = createGraphicsEditor(seed());
    editor.select('a');
    editor.toggleSelection('b');
    const before = editor.document,
      horizontal = handle === 'e' || handle === 'w';
    const negative = handle === 'w' || handle === 'n';
    const original = worldBounds(before, before.rootId);
    const origin = {
      x: handle === 'w' ? original.x : original.x + original.width,
      y: handle === 'n' ? original.y : original.y + original.height,
    };
    const changes = vi.fn();
    editor.subscribeDocument(changes);
    editor.beginTransform('a', origin, handle);
    const distance = negative ? -40 : 40;
    editor.updateTransform({
      x: origin.x + (horizontal ? distance : 123),
      y: origin.y + (horizontal ? 123 : distance),
    });
    expect(changes).not.toHaveBeenCalled();
    const bounds = worldBounds(
      before,
      before.rootId,
      editor.getSession().transform!.nodes
    );
    expect(bounds.width).toBeCloseTo(original.width + (horizontal ? 40 : 0));
    expect(bounds.height).toBeCloseTo(original.height + (horizontal ? 0 : 40));
    expect(bounds.x).toBeCloseTo(original.x - (handle === 'w' ? 40 : 0));
    expect(bounds.y).toBeCloseTo(original.y - (handle === 'n' ? 40 : 0));
    editor.commitTransform();
    expect(changes).toHaveBeenCalledTimes(1);
    editor.undo();
    expect(editor.document).toEqual(before);
    expect(editor.getSession().canUndo).toBe(false);
  }
);

it('recomputes edge modifiers without drift, including proportional shrinking and center resizing', () => {
  const b = { x: 20, y: 30, width: 100, height: 80 };
  expect(
    resizeBounds(b, 'e', { x: -25, y: 100 }, { proportional: true })
  ).toEqual({ x: 20, y: 40, width: 75, height: 60 });
  expect(
    resizeBounds(b, 'n', { x: 100, y: -20 }, { proportional: true })
  ).toEqual({ x: 7.5, y: 10, width: 125, height: 100 });
  expect(
    resizeBounds(b, 'w', { x: -10, y: 100 }, { fromCenter: true })
  ).toEqual({ x: 10, y: 30, width: 120, height: 80 });
  const editor = createGraphicsEditor(seed());
  editor.select('a');
  editor.toggleSelection('b');
  editor.beginTransform('a', { x: 320, y: 130 }, 'e');
  editor.updateTransform({ x: 290, y: 160 }, { proportional: true });
  let bounds = worldBounds(
    editor.document,
    editor.document.rootId,
    editor.getSession().transform!.nodes
  );
  expect(bounds).toEqual({ x: 20, y: 40, width: 270, height: 180 });
  editor.updateTransform({ x: 290, y: 160 }, { fromCenter: true });
  bounds = worldBounds(
    editor.document,
    editor.document.rootId,
    editor.getSession().transform!.nodes
  );
  expect(bounds).toEqual({ x: 50, y: 30, width: 240, height: 200 });
  editor.cancelTransform();
  expect(editor.document).toEqual(seed());
  expect(editor.getSession().canUndo).toBe(false);
});

it('locks a group to proportional resizing when a nested child has a different angle', () => {
  const base = seed();
  const a = base.items.a!,
    b = base.items.b!;
  if (!isShape(a) || !isShape(b)) throw new Error('Missing shapes');
  const editor = createGraphicsEditor(
    createScene([
      {
        id: 'group',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: multiply(translation(80, 60), rotation(0.5)),
      },
      {
        id: 'nested',
        type: 'group',
        placement: { parentId: 'group', sortKey: 'a0' },
        transform: multiply(translation(30, 80), rotation(-0.2)),
      },
      { ...a, placement: { parentId: 'nested', sortKey: 'a0' } },
      { ...b, placement: { parentId: 'group', sortKey: 'a1' } },
    ])
  );
  const before = editor.document,
    frame = selectionFrame(before, ['group'])!,
    bounds = frame.bounds;
  expect(frame.canDeform).toBe(false);
  const origin = {
    x: bounds.x + bounds.width,
    y: bounds.y + bounds.height / 2,
  };
  editor.beginTransform('group', transformPoint(frame.transform, origin), 'e');
  editor.updateTransform(
    transformPoint(frame.transform, {
      x: origin.x + bounds.width,
      y: origin.y + 70,
    })
  );
  const nodes = editor.getSession().transform!.nodes;
  const anchor = transformPoint(frame.transform, {
    x: bounds.x,
    y: bounds.y + bounds.height / 2,
  });
  for (const id of ['a', 'b']) {
    const old = worldMatrix(before, id),
      next = worldMatrix(before, id, nodes);
    old
      .slice(0, 4)
      .forEach((value, i) => expect(next[i]).toBeCloseTo(value * 2));
    expect(next[0] * next[2] + next[1] * next[3]).toBeCloseTo(0);
    const item = nodes[id] ?? before.items[id];
    if (!isShape(item) || item.type === 'pencil' || item.type === 'connector')
      throw new Error('Missing preview');
    const original = before.items[id];
    if (
      !isShape(original) ||
      original.type === 'pencil' ||
      original.type === 'connector'
    )
      throw new Error('Missing source');
    const center = transformPoint(old, {
      x: original.geometry.width / 2,
      y: original.geometry.height / 2,
    });
    closePoint(
      transformPoint(next, {
        x: item.geometry.width / 2,
        y: item.geometry.height / 2,
      }),
      {
        x: anchor.x + (center.x - anchor.x) * 2,
        y: anchor.y + (center.y - anchor.y) * 2,
      }
    );
    expect(item.placement).toEqual(original.placement);
  }
  expect(nodes.group).toBeDefined();
  expect(nodes.nested).toBeUndefined();
  editor.commitTransform();
  editor.undo();
  expect(editor.document).toEqual(before);
});

it('uses invisible full-edge targets in screen space and routes their pointer events to resizing', () => {
  const editor = createGraphicsEditor(seed());
  editor.zoomAt({ x: 0, y: 0 }, 2);
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
  editor.select('a');
  const handle = host.querySelector('[data-graphics-handle="e"]')!;
  expect(handle.tagName).toBe('line');
  expect(handle.getAttribute('x1')).toBe('240');
  expect(handle.getAttribute('y1')).toBe('60');
  expect(handle.getAttribute('x2')).toBe('240');
  expect(handle.getAttribute('y2')).toBe('220');
  expect(handle.getAttribute('stroke')).toBe('transparent');
  expect(handle.getAttribute('stroke-width')).toBe('10');
  expect(host.querySelectorAll('rect[data-graphics-handle]')).toHaveLength(4);
  const pointer = (
    target: Element,
    type: string,
    x: number,
    y: number,
    altKey = false
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
      altKey,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  pointer(handle, 'pointerdown', 240, 100);
  pointer(viewport, 'pointermove', 280, 160);
  expect(host.querySelectorAll('[data-graphics-handle]')).toHaveLength(0);
  pointer(viewport, 'pointerup', 280, 160, true);
  expect(worldBounds(editor.document, 'a')).toEqual({
    x: 0,
    y: 30,
    width: 140,
    height: 80,
  });
  expect(
    host.querySelectorAll(
      '[data-graphics-handle]:not([data-graphics-handle^="radius-"])'
    )
  ).toHaveLength(9);
  editor.undo();
  expect(editor.document).toEqual(seed());
  dispose();
  host.remove();
  editor.dispose();
});

it('synchronizes group edge resizing with Loro as one locally undoable action', () => {
  const lab = createGraphicsPeerLab(seed());
  lab.setConnected(false);
  try {
    const a = lab.peers[0]!.editor,
      b = lab.peers[1]!.editor;
    a.select('a');
    a.toggleSelection('b');
    a.groupSelection('group');
    lab.syncNow();
    const before = worldBounds(a.document, 'group');
    a.beginTransform('group', { x: 320, y: 130 }, 'e');
    a.updateTransform({ x: 420, y: 130 });
    a.commitTransform();
    b.select('b');
    b.setSelectionAppearance({ fill: 'green' });
    lab.syncNow();
    expect(a.document).toEqual(b.document);
    expect(worldBounds(a.document, 'group').width).toBeCloseTo(
      before.width + 100
    );
    a.undo();
    lab.syncNow();
    expect(a.document).toEqual(b.document);
    expect(worldBounds(a.document, 'group')).toEqual(before);
    expect(a.document.items.b).toMatchObject({ appearance: { fill: 'green' } });
  } finally {
    lab.dispose();
  }
});
