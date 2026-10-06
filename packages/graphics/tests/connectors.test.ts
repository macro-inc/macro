import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alignCommand,
  type ConnectorAnchor,
  connectorDefinition,
  connectorDropTarget,
  connectorPorts,
  connectorStyleCommand,
  connectorTargetAt,
  copyFragment,
  createConnectorInteraction,
  createGraphicsEditor,
  createScene,
  deleteSubtrees,
  distributeCommand,
  duplicateNodes,
  freezeDocument,
  type GraphicsDocument,
  groupNodes,
  hitTest,
  IDENTITY,
  layoutBounds,
  multiply,
  paintOrder,
  pasteFragment,
  reorderNodes,
  resolveConnector,
  rotation,
  type ShapeItem,
  scaling,
  selectionFrame,
  setConnectorCommand,
  transformPoint,
  translation,
  worldBounds,
  worldMatrix,
} from '../src/core';
import { connectorWorldView } from '../src/core/connectors';
import {
  connectorHead,
  connectorPath,
} from '../src/core/shapes/connector-routing';
import { createGraphicsPeerLab } from './helpers/peer-lab';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
const rect = (id = 'a', x = 0): ShapeItem<'rectangle'> => ({
  id,
  type: 'rectangle',
  placement: { parentId: 'scene-root', sortKey: id === 'a' ? 'a0' : 'a1' },
  transform: translation(x, 0),
  geometry: { width: 100, height: 80 },
  appearance: { fill: 'transparent', stroke: 'black' },
});
const link = (
  start: ConnectorAnchor = 'right',
  end: ConnectorAnchor = 'left'
): ShapeItem<'connector'> => ({
  id: 'link',
  type: 'connector',
  placement: { parentId: 'scene-root', sortKey: 'a2' },
  transform: IDENTITY,
  appearance: { fill: 'transparent', stroke: 'black' },
  geometry: {
    start: {
      point: { x: 100, y: 40 },
      binding: { targetId: 'a', anchor: start },
    },
    end: { point: { x: 300, y: 40 }, binding: { targetId: 'b', anchor: end } },
    route: 'stepped',
    startHead: 'none',
    endHead: 'arrow',
  },
});
const scene = () => createScene([rect(), rect('b', 300), link()]);
const pencil = (): ShapeItem<'pencil'> => ({
  id: 'ink',
  type: 'pencil',
  placement: { parentId: 'scene-root', sortKey: 'a3' },
  transform: IDENTITY,
  geometry: {
    points: [
      [0, 0, 0.5],
      [50, 40, 0.5],
      [100, 80, 0.5],
    ],
    simulatePressure: false,
  },
  appearance: { fill: 'transparent', stroke: 'black', strokeWidth: 4 },
});
const resolved = (doc: GraphicsDocument) =>
  resolveConnector(doc, doc.items.link as ShapeItem<'connector'>).geometry;
const close = (
  actual: { x: number; y: number },
  expected: { x: number; y: number }
) => {
  expect(actual.x).toBeCloseTo(expected.x, 7);
  expect(actual.y).toBeCloseTo(expected.y, 7);
};

describe('connector anchors', () => {
  it('skips pencil ink and its bounds, including ink above an eligible shape', () => {
    const doc = createScene([pencil()]);
    expect(connectorPorts(doc)).toEqual([]);
    for (const point of [
      { x: 50, y: 40 },
      { x: 25, y: 50 },
    ]) {
      expect(connectorTargetAt(doc, point, 14)).toBeUndefined();
      expect(connectorDropTarget(doc, point, 14)).toBeUndefined();
    }
    expect(
      connectorTargetAt(createScene([rect(), pencil()]), { x: 50, y: 40 }, 14)
        ?.targetId
    ).toBe('a');
  });
  it('loads old pencil bindings using stored endpoints without following the ink', () => {
    const connector = link();
    const doc = createScene([
      pencil(),
      {
        ...connector,
        geometry: {
          ...connector.geometry,
          start: {
            point: { x: 50, y: 40 },
            binding: { targetId: 'ink', anchor: 'center' },
          },
          end: { point: { x: 300, y: 40 } },
        },
      },
    ]);
    expect(resolved(doc).start.point).toEqual({ x: 50, y: 40 });
    expect(
      resolveConnector(doc, doc.items.link as ShapeItem<'connector'>, {
        ink: { ...pencil(), transform: translation(200, 100) },
      }).geometry.start.point
    ).toEqual({ x: 50, y: 40 });
  });
  it('offers five ports per shape with screen-independent world positions and frontmost ties', () => {
    const doc = scene(),
      ports = connectorPorts(doc);
    expect(ports).toHaveLength(10);
    expect(ports.filter((p) => p.targetId === 'a').map((p) => p.point)).toEqual(
      [
        { x: 50, y: 40 },
        { x: 50, y: 0 },
        { x: 100, y: 40 },
        { x: 50, y: 80 },
        { x: 0, y: 40 },
      ]
    );
    expect(connectorDropTarget(doc, { x: 102, y: 40 }, 3)?.anchor).toBe(
      'right'
    );
    expect(connectorDropTarget(doc, { x: 104, y: 40 }, 3)).toBeUndefined();
    expect(
      connectorDropTarget(createScene([rect(), rect('b')]), { x: 50, y: 40 }, 3)
        ?.targetId
    ).toBe('b');
  });
  it('resolves center drops against the rectangle and ellipse outline', () => {
    const b = { ...rect('b', 300), type: 'ellipse' as const };
    const doc = createScene([rect(), b, link('center', 'center')]);
    close(resolved(doc).start.point, { x: 100, y: 40 });
    close(resolved(doc).end.point, { x: 300, y: 40 });
    const moved = {
      ...doc,
      items: { ...doc.items, b: { ...b, transform: translation(300, 200) } },
    };
    const g = resolved(moved),
      p = g.end.point;
    expect(((p.x - 350) / 50) ** 2 + ((p.y - 240) / 40) ** 2).toBeCloseTo(1);
    expect(g.start.point.y).toBeGreaterThan(40);
  });
  it('uses the rounded outline at a corner', () => {
    const a = {
      ...rect(),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'transparent', stroke: 'black', cornerRadius: 20 },
    };
    const b = {
      ...rect('b', 300),
      transform: translation(300, 300),
      geometry: { width: 100, height: 100 },
    };
    const g = resolved(createScene([a, b, link('center', 'center')]));
    close(g.start.point, { x: 80 + Math.sqrt(200), y: 80 + Math.sqrt(200) });
  });
  it('follows nested rotations and geometry previews without touching stored endpoints', () => {
    const a = {
      ...rect(),
      placement: { parentId: 'group', sortKey: 'a0' },
      transform: rotation(0.3),
    };
    const doc = createScene([
      {
        id: 'group',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: multiply(translation(50, 75), rotation(0.8)),
      },
      a,
      rect('b', 300),
      link(),
    ]);
    const preview = { ...a, geometry: { width: 220, height: 100 } };
    const g = resolveConnector(doc, doc.items.link as ShapeItem<'connector'>, {
      a: preview,
    }).geometry;
    close(
      g.start.point,
      transformPoint(worldMatrix(doc, 'a'), { x: 220, y: 50 })
    );
    close(g.start.direction!, { x: Math.cos(1.1), y: Math.sin(1.1) });
    expect(
      (doc.items.link as ShapeItem<'connector'>).geometry.start.point
    ).toEqual({ x: 100, y: 40 });
  });
  it('uses inverse transpose normals under nonuniform ancestor transforms', () => {
    const a = {
      ...rect(),
      transform: multiply(scaling(2, 1), rotation(Math.PI / 4)),
    };
    const doc = createScene([a, rect('b', 300), link()]);
    const n = resolved(doc).start.direction!;
    const edge = { x: a.transform[2], y: a.transform[3] };
    expect(n.x * edge.x + n.y * edge.y).toBeCloseTo(0);
  });
  it('ignores missing targets and rejects connector-to-connector bindings', () => {
    const doc = scene(),
      item = doc.items.link as ShapeItem<'connector'>;
    const missing = { ...doc, items: { ...doc.items } };
    delete missing.items.a;
    expect(resolved(freezeDocument(missing)).start.point).toEqual(
      item.geometry.start.point
    );
    expect(() =>
      createScene([
        {
          ...item,
          geometry: {
            ...item.geometry,
            start: {
              ...item.geometry.start,
              binding: { targetId: 'link', anchor: 'center' },
            },
          },
        },
      ])
    ).toThrow('Invalid connector target');
  });
});

describe('legacy routes and picking', () => {
  it('preserves rounded elbow leads and smooth controls', () => {
    const a = { point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      b = { point: { x: 200, y: 100 }, direction: { x: -1, y: 0 } };
    const elbow = connectorPath(a, b, 'stepped');
    expect(elbow.segments[0]!.to).toEqual({ x: 90, y: 0 });
    expect(elbow.segments[1]!.controls).toEqual([
      { x: 95.5, y: 0 },
      { x: 100, y: 4.5 },
    ]);
    expect(elbow.segments.at(-1)!.to).toEqual(b.point);
    const curve = connectorPath(a, b, 'smooth'),
      strength = Math.hypot(200, 100) / 2;
    expect(curve.segments[0]!.controls).toEqual([
      { x: strength, y: 0 },
      { x: 200 - strength, y: 100 },
    ]);
    const straight = connectorPath(a, b, 'straight');
    expect(straight.path).toBe('M 0 0 L 200 100');
    expect(connectorHead(b.point, straight.to, 'circle').radius).toBe(6);
    expect(connectorHead(b.point, straight.to, 'circle-small').radius).toBe(3);
    expect(connectorHead(b.point, straight.to, 'arrow-filled').path).toMatch(
      / Z$/
    );
  });
  it.each([
    'straight',
    'stepped',
    'smooth',
  ] as const)('picks the actual %s path, not its box', (route) => {
    const item = link();
    const g = {
      ...item.geometry,
      route,
      start: { point: { x: 0, y: 0 } },
      end: { point: { x: 200, y: 100 } },
    };
    const doc = createScene([{ ...item, geometry: g }]),
      path = connectorPath(g.start, g.end, route);
    const p = path.points[Math.floor(path.points.length / 2)]!;
    expect(hitTest(doc, p, false, 3)).toBe('link');
    expect(hitTest(doc, { x: 20, y: 85 }, false, 3)).toBeUndefined();
    expect(
      connectorDefinition.intersectsBox({ ...item, geometry: g }, IDENTITY, {
        x: p.x - 1,
        y: p.y - 1,
        width: 2,
        height: 2,
      })
    ).toBe(true);
  });
});

describe('document reference lifecycle', () => {
  it('follows target moves live, detaches deleted targets in place, and restores with undo', () => {
    const editor = createGraphicsEditor(scene());
    cleanups.push(editor.dispose);
    editor.select('a');
    editor.beginTransform('a', { x: 0, y: 0 });
    editor.updateTransform({ x: 20, y: 60 });
    const preview = resolveConnector(
      editor.document,
      editor.document.items.link as ShapeItem<'connector'>,
      editor.getSession().transform!.nodes
    );
    close(preview.geometry.start.point, { x: 120, y: 100 });
    editor.commitTransform();
    expect(resolved(editor.document)).toEqual(preview.geometry);
    const before = editor.document;
    editor.deleteSelection();
    expect(resolved(editor.document).start).toMatchObject({
      point: { x: 120, y: 100 },
    });
    expect(resolved(editor.document).start.binding).toBeUndefined();
    editor.undo();
    expect(editor.document).toEqual(before);
  });
  it('moving a connector body leaves bound ends fixed and moves free ends', () => {
    const item = link(),
      doc = createScene([
        rect(),
        {
          ...item,
          geometry: { ...item.geometry, end: { point: { x: 200, y: 100 } } },
        },
      ]);
    const editor = createGraphicsEditor(doc);
    cleanups.push(editor.dispose);
    editor.select('link');
    editor.beginTransform('link', { x: 150, y: 70 });
    editor.updateTransform({ x: 170, y: 90 });
    editor.commitTransform();
    const g = resolved(editor.document),
      world = worldMatrix(editor.document, 'link');
    close(transformPoint(world, g.start.point), { x: 100, y: 40 });
    close(transformPoint(world, g.end.point), { x: 220, y: 120 });
  });
  it('copies connected objects with remapped references and a connector alone with detached ends', () => {
    const doc = scene();
    let index = 0;
    const pasted = pasteFragment(
      doc,
      copyFragment(doc, ['a', 'b', 'link'])!,
      () => `copy-${index++}`
    );
    const clone = pasted.document.items['copy-2'] as ShapeItem<'connector'>;
    expect(clone.geometry.start.binding?.targetId).toBe('copy-0');
    expect(clone.geometry.end.binding?.targetId).toBe('copy-1');
    close(
      transformPoint(
        worldMatrix(pasted.document, clone.id),
        resolveConnector(pasted.document, clone).geometry.start.point
      ),
      { x: 124, y: 64 }
    );
    const alone = copyFragment(doc, ['link'])!.scene.items
      .link as ShapeItem<'connector'>;
    expect(alone.geometry.start.binding).toBeUndefined();
    expect(alone.geometry.end.binding).toBeUndefined();
  });
  it('duplicates connections across different parents without referencing originals', () => {
    const doc = createScene([
      {
        id: 'group',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: translation(10, 20),
      },
      { ...rect(), placement: { parentId: 'group', sortKey: 'a0' } },
      rect('b', 300),
      link(),
    ]);
    let index = 0;
    const result = duplicateNodes(
      doc,
      ['a', 'b', 'link'],
      () => `copy-${index++}`
    );
    const clone = result.document.items['copy-2'] as ShapeItem<'connector'>;
    expect(clone.geometry.start.binding?.targetId).toBe('copy-0');
    expect(clone.geometry.end.binding?.targetId).toBe('copy-1');
    close(
      transformPoint(
        worldMatrix(result.document, clone.id),
        resolveConnector(result.document, clone).geometry.start.point
      ),
      { x: 134, y: 84 }
    );
    expect(
      deleteSubtrees(result.document, ['group']).items[clone.id]
    ).toBeDefined();
  });
  it('syncs connector bindings, target moves, and local undo through Loro without a backend', () => {
    const lab = createGraphicsPeerLab(scene());
    cleanups.push(lab.dispose);
    lab.setConnected(false);
    const a = lab.peers[0]!.editor,
      b = lab.peers[1]!.editor;
    a.select('link');
    a.execute(connectorStyleCommand, { route: 'smooth', endHead: 'circle' });
    lab.syncNow();
    expect(b.document).toEqual(a.document);
    a.select('a');
    a.beginTransform('a', { x: 0, y: 0 });
    a.updateTransform({ x: 25, y: 60 });
    a.commitTransform();
    lab.syncNow();
    close(resolved(b.document).start.point, { x: 125, y: 100 });
    a.undo();
    lab.syncNow();
    close(resolved(b.document).start.point, { x: 100, y: 40 });
  });
});

describe('endpoint interaction', () => {
  it('never binds either end to pencil strokes when creating or reconnecting', () => {
    const editor = createGraphicsEditor([pencil()]);
    cleanups.push(editor.dispose);
    const op = createConnectorInteraction({
      getDocument: () => editor.document,
      commit: (item) => editor.execute(setConnectorCommand, item),
      onChange: () => {},
    });
    op.hover({ x: 50, y: 40 }, 14);
    expect(op.getTarget()).toBeUndefined();
    op.begin(
      'link',
      { x: 25, y: 20 },
      rect().appearance,
      { route: 'straight', startHead: 'none', endHead: 'arrow' },
      14
    );
    op.update({ x: 75, y: 60 }, 14);
    expect(op.getState()?.dropTarget).toBeUndefined();
    expect(op.commit()).toBe(true);
    const geometry = resolved(editor.document);
    expect(geometry.start).toEqual({ point: { x: 25, y: 20 } });
    expect(geometry.end).toEqual({ point: { x: 75, y: 60 } });
    for (const endpoint of ['start', 'end'] as const) {
      op.edit('link', endpoint);
      op.update({ x: 50, y: 40 }, 14);
      expect(op.getTarget()).toBeUndefined();
      op.commit();
      expect(resolved(editor.document)[endpoint]).toEqual({
        point: { x: 50, y: 40 },
      });
    }
  });
  it('keeps previews outside history, supports both handles, cancels, and commits once', () => {
    const editor = createGraphicsEditor([rect(), rect('b', 300)]);
    cleanups.push(editor.dispose);
    const onChange = vi.fn(),
      op = createConnectorInteraction({
        getDocument: () => editor.document,
        commit: (item) => editor.execute(setConnectorCommand, item),
        onChange,
      });
    const before = editor.document;
    op.begin(
      'link',
      { x: 100, y: 40 },
      { fill: 'transparent', stroke: 'black' },
      { route: 'stepped', startHead: 'none', endHead: 'arrow' },
      14
    );
    op.update({ x: 299, y: 40 }, 14);
    expect(op.getState()?.dropTarget?.anchor).toBe('left');
    expect(editor.document).toBe(before);
    expect(editor.getSession().canUndo).toBe(false);
    expect(op.commit()).toBe(true);
    expect(resolved(editor.document).end.binding?.targetId).toBe('b');
    editor.undo();
    expect(editor.document).toEqual(before);
    editor.redo();
    const committed = editor.document;
    op.edit('link', 'start');
    op.update({ x: 50, y: 80 }, 14);
    op.cancel();
    expect(editor.document).toBe(committed);
    op.edit('link', 'start');
    op.update({ x: 50, y: 80 }, 14);
    op.commit();
    expect(resolved(editor.document).start.binding?.anchor).toBe('bottom');
    editor.undo();
    expect(editor.document).toEqual(committed);
    op.edit('link', 'end');
    op.update({ x: 500, y: 60 }, 14, true);
    op.commit();
    expect(resolved(editor.document).end.binding).toBeUndefined();
    expect(resolved(editor.document).end.point.y).toBeCloseTo(40);
    expect(onChange).toHaveBeenCalled();
  });
  it('does not create a connector for an accidental click', () => {
    const commit = vi.fn(),
      op = createConnectorInteraction({
        getDocument: () => createScene([]),
        commit,
        onChange: () => {},
      });
    op.begin(
      'link',
      { x: 0, y: 0 },
      { fill: 'transparent', stroke: 'black' },
      { route: 'straight', startHead: 'none', endHead: 'none' },
      14
    );
    expect(op.commit(3)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });
});

it('pastes dangling references as free endpoints even if the destination has matching IDs', () => {
  const source = createScene([link()]);
  const result = pasteFragment(
    scene(),
    { kind: 'macro-graphics-fragment', scene: source },
    () => 'pasted'
  );
  const item = result.document.items.pasted as ShapeItem<'connector'>;
  expect(item.geometry.start.binding).toBeUndefined();
  expect(item.geometry.end.binding).toBeUndefined();
  close(
    transformPoint(
      worldMatrix(result.document, 'pasted'),
      item.geometry.start.point
    ),
    { x: 124, y: 64 }
  );
});

it('keeps target references through grouping and reparenting into a rotated ancestor', () => {
  const doc = scene();
  const editor = createGraphicsEditor({
    ...doc,
    items: {
      ...doc.items,
      parent: {
        id: 'parent',
        type: 'group',
        placement: { parentId: doc.rootId, sortKey: 'a3' },
        transform: multiply(translation(500, 60), rotation(0.8)),
      },
    },
  });
  cleanups.push(editor.dispose);
  const before = resolved(editor.document);
  editor.reparent('a', 'parent');
  close(resolved(editor.document).start.point, before.start.point);
  editor.select('parent');
  editor.beginTransform('parent', { x: 0, y: 0 });
  editor.updateTransform({ x: 50, y: 75 });
  editor.commitTransform();
  close(resolved(editor.document).start.point, { x: 150, y: 115 });
  editor.undo();
  editor.undo();
  close(resolved(editor.document).start.point, before.start.point);
  editor.select('a');
  editor.toggleSelection('b');
  editor.groupSelection('grouped');
  expect(resolved(editor.document)).toEqual(before);
  editor.ungroupSelection();
  expect(resolved(editor.document)).toEqual(before);
});

it('converges after concurrent target deletion and endpoint editing without invalid references', () => {
  const lab = createGraphicsPeerLab(scene());
  cleanups.push(lab.dispose);
  lab.setConnected(false);
  const a = lab.peers[0]!.editor,
    b = lab.peers[1]!.editor;
  a.select('a');
  a.deleteSelection();
  const item = b.document.items.link as ShapeItem<'connector'>;
  b.execute(setConnectorCommand, {
    ...item,
    geometry: {
      ...item.geometry,
      start: {
        ...item.geometry.start,
        binding: { targetId: 'a', anchor: 'bottom' },
      },
    },
  });
  lab.syncNow();
  expect(a.document).toEqual(b.document);
  expect(a.document.items.a).toBeUndefined();
  expect(() => freezeDocument(a.document)).not.toThrow();
  const point = resolved(a.document).start.point;
  expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
});

it('reveals only the hovered shape and activates its core or the nearest edge port', () => {
  const doc = scene();
  expect(connectorTargetAt(doc, { x: 180, y: 150 }, 14)).toBeUndefined();
  const core = connectorTargetAt(doc, { x: 23, y: 25 }, 14)!;
  expect(core.targetId).toBe('a');
  expect(core.ports).toHaveLength(5);
  expect(core.active?.anchor).toBe('center');
  expect(connectorTargetAt(doc, { x: 98, y: 38 }, 14)?.active?.anchor).toBe(
    'right'
  );
  // Hovering the boundary away from a handle exposes the ports without a halo.
  const rim = connectorTargetAt(doc, { x: 96, y: 20 }, 14)!;
  expect(rim.targetId).toBe('a');
  expect(rim.active).toBeUndefined();
  expect(connectorTargetAt(doc, { x: 323, y: 25 }, 14)?.targetId).toBe('b');
  // The radius is in world units supplied by the camera: 14 px at 2x = 7.
  expect(connectorTargetAt(doc, { x: 108, y: 40 }, 7)).toBeUndefined();
  expect(connectorTargetAt(doc, { x: 108, y: 40 }, 14)?.active?.anchor).toBe(
    'right'
  );
});

it('honors curved outlines, transformed interiors and frontmost targets for connector hover', () => {
  const ellipse = { ...rect(), type: 'ellipse' as const };
  expect(
    connectorTargetAt(createScene([ellipse]), { x: 1, y: 1 }, 14)
  ).toBeUndefined();
  const rounded = {
    ...rect(),
    appearance: { ...rect().appearance, cornerRadius: 30 },
  };
  expect(
    connectorTargetAt(createScene([rounded]), { x: 1, y: 1 }, 14)
  ).toBeUndefined();
  const rotated = {
    ...ellipse,
    transform: multiply(translation(300, 100), rotation(0.7)),
  };
  const point = transformPoint(rotated.transform, { x: 35, y: 35 });
  expect(
    connectorTargetAt(createScene([rotated]), point, 14)?.active?.anchor
  ).toBe('center');
  const overlapping = createScene([rect(), rect('b', 5)]);
  expect(connectorTargetAt(overlapping, { x: 25, y: 25 }, 14)?.targetId).toBe(
    'b'
  );
});

it('uses the same core target before pointerdown, at the starting endpoint, and when reconnecting either end', () => {
  const commit = vi.fn();
  const op = createConnectorInteraction({
    getDocument: scene,
    commit,
    onChange: () => {},
  });
  op.hover({ x: 23, y: 25 }, 14);
  const target = op.getTarget();
  op.begin(
    'new',
    { x: 23, y: 25 },
    rect().appearance,
    { route: 'stepped', startHead: 'none', endHead: 'arrow' },
    14
  );
  expect(op.getTarget()).toEqual(target);
  expect(op.getState()?.dropTarget).toEqual(target?.active);
  expect(op.getState()?.item.geometry.start.binding).toEqual({
    targetId: 'a',
    anchor: 'center',
  });
  expect(op.commit(3)).toBe(false);
  expect(commit).not.toHaveBeenCalled();
  for (const endpoint of ['start', 'end'] as const) {
    op.edit('link', endpoint);
    op.update({ x: 23, y: 25 }, 14);
    expect(op.getTarget()?.active?.anchor).toBe('center');
    expect(op.getState()?.item.geometry[endpoint].binding).toEqual({
      targetId: 'a',
      anchor: 'center',
    });
    op.cancel();
  }
});

it('paints a bound connector above both endpoints after stacking or grouping changes', () => {
  let doc = scene();
  doc = reorderNodes(doc, ['link'], 'back');
  expect(paintOrder(doc).indexOf('link')).toBeGreaterThan(
    paintOrder(doc).indexOf('a')
  );
  expect(paintOrder(doc).indexOf('link')).toBeGreaterThan(
    paintOrder(doc).indexOf('b')
  );
  doc = groupNodes(doc, ['a', 'link'], 'group');
  doc = reorderNodes(doc, ['b'], 'front');
  expect(paintOrder(doc).indexOf('link')).toBeGreaterThan(
    paintOrder(doc).indexOf('b')
  );
});
it('excludes bound connectors from alignment and distribution, retaining their bindings', () => {
  const editor = createGraphicsEditor(scene());
  editor.select('a');
  editor.toggleSelection('b');
  editor.toggleSelection('link');
  const connector = editor.document.items.link;
  editor.execute(alignCommand, 'left');
  expect(worldMatrix(editor.document, 'a')[4]).toBe(0);
  expect(worldMatrix(editor.document, 'b')[4]).toBe(0);
  expect(editor.document.items.link).toEqual(connector);
  editor.undo();
  const before = editor.document;
  editor.execute(distributeCommand, 'horizontal');
  expect(editor.document).toBe(before); // two eligible objects, not three
  editor.dispose();
});
it('ignores a fully bound connector extending outside a selected group in layout bounds', () => {
  const grouped = groupNodes(scene(), ['a', 'link'], 'group');
  expect(layoutBounds(grouped, 'group')).toEqual({
    x: 0,
    y: 0,
    width: 100,
    height: 80,
  });
});
it('keeps partially attached connectors in layout calculations', () => {
  const doc = scene();
  const connector = link();
  const partial = freezeDocument({
    ...doc,
    items: {
      ...doc.items,
      link: {
        ...connector,
        geometry: { ...connector.geometry, end: { point: { x: 600, y: 40 } } },
      },
    },
  });
  const grouped = groupNodes(partial, ['a', 'link'], 'group');
  expect(layoutBounds(grouped, 'group').width).toBeGreaterThan(100);
});

it('renders connected strokes and heads in world units after connector or group scaling', () => {
  const base = scene();
  const grouped = groupNodes(base, ['a', 'b', 'link'], 'group');
  for (const parentId of ['link', 'group']) {
    const item = grouped.items[parentId]!;
    if (item.type === 'surface') throw new Error('expected transformable item');
    const document = {
      ...grouped,
      items: {
        ...grouped.items,
        [parentId]: { ...item, transform: scaling(4, 2) },
      },
    };
    const resolved = resolveConnector(
      document,
      document.items.link as ShapeItem<'connector'>
    );
    const world = worldMatrix(document, 'link');
    const view = connectorWorldView(resolved, world);
    expect(view.transform).toEqual(IDENTITY);
    expect(worldBounds(document, 'link')).toEqual(
      connectorDefinition.bounds(view)
    );
    expect(selectionFrame(document, ['link'])!.bounds).toEqual(
      connectorDefinition.bounds(view)
    );
    expect(view.appearance).toEqual(resolved.appearance);
    close(
      view.geometry.start.point,
      transformPoint(world, resolved.geometry.start.point)
    );
    close(
      view.geometry.end.point,
      transformPoint(world, resolved.geometry.end.point)
    );
    expect(
      Math.hypot(
        view.geometry.start.direction!.x,
        view.geometry.start.direction!.y
      )
    ).toBeCloseTo(1);
  }
});

it('bounds smooth curves at their extrema rather than their control points', () => {
  const route = connectorPath(
    { point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
    { point: { x: 0, y: 200 }, direction: { x: 1, y: 0 } },
    'smooth'
  );
  expect(route.bounds).toEqual({ x: 0, y: 0, width: 75, height: 200 });
});
