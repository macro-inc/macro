import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  createScene,
  enclosing,
  type Matrix,
  multiply,
  nodeCorners,
  rotation,
  scaling,
  selectionFrame,
  translation,
  worldBounds,
  worldMatrix,
} from '../src/core';
import { GraphicsSurface } from '../src/solid';

const angle = Math.PI / 5;
const fixture = (grouped: boolean, childRotation = 0, orientation = angle) =>
  createScene([
    ...(grouped
      ? [
          {
            id: 'g',
            type: 'group' as const,
            placement: { parentId: 'scene-root', sortKey: 'a0' },
            transform: rotation(orientation),
          },
        ]
      : []),
    ...['a', 'b'].map((id, i) => ({
      id,
      type: 'rectangle' as const,
      placement: { parentId: grouped ? 'g' : 'scene-root', sortKey: `a${i}` },
      transform: multiply(
        grouped ? rotation(0) : rotation(orientation),
        multiply(
          translation(20 + i * 200, 30 + i * 120),
          rotation(i * childRotation)
        )
      ),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'red', stroke: 'black' },
    })),
  ]);
const closeMatrix = (a: Matrix, b: Matrix) =>
  a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, 8));

it('keeps groups and multiple selections world-aligned, including a shared rotation', () => {
  const shared = selectionFrame(fixture(false), ['a', 'b'])!;
  expect(shared.angle).toBe(0);
  expect(shared.bounds).toEqual(worldBounds(fixture(false), 'scene-root'));
  expect(shared.canDeform).toBe(false);
  const mixed = selectionFrame(fixture(false, 0.3), ['a', 'b'])!;
  expect(mixed.angle).toBe(0);
  expect(mixed.canDeform).toBe(false);
  const group = selectionFrame(fixture(true, 0.3), ['g', 'a'])!;
  expect(group.angle).toBe(0);
  expect(group.canDeform).toBe(false);
  expect(selectionFrame(fixture(true, Math.PI / 2, 0), ['g'])?.canDeform).toBe(
    true
  );
});

it.each([
  false,
  true,
])('resizes the world-aligned box without skewing rotated children with grouped=%s', (grouped) => {
  for (const handle of ['e', 'se'] as const) {
    const editor = createGraphicsEditor(fixture(grouped));
    const selected = grouped ? ['g'] : ['a', 'b'];
    editor.select(selected[0]);
    if (!grouped) editor.toggleSelection('b');
    const before = editor.document;
    const frame = selectionFrame(before, selected)!;
    const origin = {
      x: frame.bounds.x + frame.bounds.width,
      y: frame.bounds.y + frame.bounds.height,
    };
    editor.beginTransform(selected[0]!, origin, handle);
    editor.updateTransform({
      x: origin.x + frame.bounds.width / 2,
      y: origin.y + frame.bounds.height / 4,
    });
    const nodes = editor.getSession().transform!.nodes;
    const bounds = enclosing(
      ['a', 'b'].flatMap((id) => nodeCorners(before, id, nodes))
    );
    expect(bounds.x).toBeCloseTo(frame.bounds.x);
    expect(bounds.y).toBeCloseTo(
      frame.bounds.y - (handle === 'e' ? frame.bounds.height / 4 : 0)
    );
    expect(bounds.width).toBeCloseTo(frame.bounds.width * 1.5);
    expect(bounds.height).toBeCloseTo(frame.bounds.height * 1.5);
    for (const id of ['a', 'b']) {
      const original = worldMatrix(before, id);
      const next = worldMatrix(before, id, nodes);
      original
        .slice(0, 4)
        .forEach((value, i) => expect(next[i]).toBeCloseTo(value * 1.5));
      expect(next[0] * next[2] + next[1] * next[3]).toBeCloseTo(0);
      expect(nodes[id] ?? before.items[id]).toMatchObject({
        placement: {
          parentId: grouped ? 'g' : 'scene-root',
          sortKey: id === 'a' ? 'a0' : 'a1',
        },
      });
    }
    expect(editor.document).toBe(before);
    editor.commitTransform();
    expect(selectionFrame(editor.document, selected)?.angle).toBeCloseTo(
      frame.angle
    );
    editor.undo();
    expect(editor.document).toEqual(before);
    expect(editor.getSession().canUndo).toBe(false);
    editor.dispose();
  }
});

it.each([
  false,
  true,
])('recomputes center resizing in a rotated frame with proportional=%s', (proportional) => {
  const editor = createGraphicsEditor(fixture(true));
  const before = editor.document;
  const frame = selectionFrame(before, ['g'])!;
  const start = {
    x: frame.bounds.x + frame.bounds.width,
    y: frame.bounds.y + frame.bounds.height / 2,
  };
  const end = { x: start.x - 30, y: start.y + 60 };
  editor.beginTransform('g', start, 'e');
  editor.updateTransform(end, { fromCenter: true, proportional });
  const next = selectionFrame(
    before,
    ['g'],
    editor.getSession().transform!.nodes
  )!;
  expect(next.bounds.width).toBeCloseTo(frame.bounds.width - 60);
  expect(next.bounds.height).toBeCloseTo(
    frame.bounds.height * (1 - 60 / frame.bounds.width)
  );
  expect(next.center.x).toBeCloseTo(frame.center.x);
  expect(next.center.y).toBeCloseTo(frame.center.y);
  editor.updateTransform(start, { fromCenter: true, proportional });
  closeMatrix(
    worldMatrix(before, 'a', editor.getSession().transform!.nodes),
    worldMatrix(before, 'a')
  );
  editor.cancelTransform();
  expect(editor.document).toBe(before);
  editor.dispose();
});

it('aligns the rotator with each selection frame and keeps square handles', () => {
  const editor = createGraphicsEditor(fixture(false));
  const host = document.createElement('div');
  const dispose = render(
    () => <GraphicsSurface editor={editor} input={{ tool: () => 'select' }} />,
    host
  );
  const box = () => host.querySelector('[data-graphics-selection-bounds]')!;
  editor.select('a');
  expect(host.querySelectorAll('polygon')).toHaveLength(1);
  expect(box().getAttribute('stroke-dasharray')).toBeNull();
  const points = nodeCorners(editor.document, 'a');
  const rendered = box()
    .getAttribute('points')!
    .split(' ')
    .map((point) => point.split(',').map(Number));
  points.forEach((point, i) => {
    expect(rendered[i]![0]).toBeCloseTo(point.x);
    expect(rendered[i]![1]).toBeCloseTo(point.y);
  });
  const circle = () => host.querySelector('[data-graphics-handle="rotate"]')!;
  expect(Number(circle().getAttribute('cx'))).toBeCloseTo(
    (points[0]!.x + points[1]!.x) / 2 + 16 * Math.sin(angle)
  );
  expect(Number(circle().getAttribute('cy'))).toBeCloseTo(
    (points[0]!.y + points[1]!.y) / 2 - 16 * Math.cos(angle)
  );
  for (const handle of host.querySelectorAll<SVGElement>(
    'rect[data-graphics-handle], line[data-graphics-handle]'
  )) {
    const id = handle.getAttribute('data-graphics-handle');
    expect(handle.style.cursor).toBe(
      id === 'n' || id === 's'
        ? 'ns-resize'
        : id === 'e' || id === 'w'
          ? 'ew-resize'
          : id === 'nw' || id === 'se'
            ? 'nwse-resize'
            : 'nesw-resize'
    );
    expect(handle.hasAttribute('transform')).toBe(false);
  }
  editor.toggleSelection('b');
  expect(box().getAttribute('stroke-dasharray')).toBe('3 3');
  const bounds = enclosing(
    ['a', 'b'].flatMap((id) => nodeCorners(editor.document, id))
  );
  expect(Number(circle().getAttribute('cx'))).toBeCloseTo(
    bounds.x + bounds.width / 2
  );
  expect(Number(circle().getAttribute('cy'))).toBeCloseTo(bounds.y - 16);
  editor.groupSelection('group');
  expect(host.querySelectorAll('polygon')).toHaveLength(1);
  expect(box().getAttribute('stroke-dasharray')).toBe('3 3');
  expect(host.querySelectorAll('line[data-graphics-handle]')).toHaveLength(4);
  expect(Number(circle().getAttribute('cx'))).toBeCloseTo(
    bounds.x + bounds.width / 2
  );
  expect(Number(circle().getAttribute('cy'))).toBeCloseTo(bounds.y - 16);
  dispose();
  editor.dispose();
});

it.each([
  {
    transform: rotation(Math.PI / 4),
    cursors: ['nwse', 'nwse', 'nwse', 'nwse'],
  },
  {
    transform: rotation(Math.PI / 2),
    cursors: ['nesw', 'nwse', 'nesw', 'nwse'],
  },
  { transform: scaling(-1, 1), cursors: ['nesw', 'nwse', 'nesw', 'nwse'] },
])('uses world corner positions for hover and drag cursors with $transform', ({
  transform,
  cursors,
}) => {
  const seed = fixture(true);
  const editor = createGraphicsEditor({
    ...seed,
    items: {
      ...seed.items,
      g: {
        id: 'g',
        type: 'group',
        placement: { parentId: seed.rootId, sortKey: 'a0' },
        transform,
      },
    },
  });
  editor.zoomAt({ x: 0, y: 0 }, 2);
  editor.panBy({ x: 300, y: 300 });
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
  for (const [index, name] of ['nw', 'ne', 'se', 'sw'].entries()) {
    const handle = host.querySelector<SVGElement>(
      `[data-graphics-handle="${name}"]`
    )!;
    const cursor = `${cursors[index]}-resize`;
    expect(handle.style.cursor).toBe(cursor);
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: Number(handle.getAttribute('x')) + 5,
      clientY: Number(handle.getAttribute('y')) + 5,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    handle.dispatchEvent(event);
    expect(editor.getSession().transform?.kind).toBe('resize');
    expect(viewport.style.cursor).toBe(cursor);
    const cancel = new MouseEvent('pointercancel', { bubbles: true });
    Object.defineProperty(cancel, 'pointerId', { value: 1 });
    viewport.dispatchEvent(cancel);
  }
  for (const edge of ['n', 'e', 's', 'w']) {
    expect(
      host.querySelector<SVGElement>(`[data-graphics-handle="${edge}"]`)!.style
        .cursor
    ).toBe(edge === 'n' || edge === 's' ? 'ns-resize' : 'ew-resize');
  }
  dispose();
  host.remove();
  editor.dispose();
});
