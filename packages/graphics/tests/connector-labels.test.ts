import { expect, it } from 'vitest';
import {
  connectorDefinition,
  copyFragment,
  createGraphicsEditor,
  createScene,
  IDENTITY,
  multiply,
  parseFragment,
  rotation,
  type ShapeItem,
  type ShapeLabel,
  setShapeLabelCommand,
  shapeLabelLayout,
  shapeProjection,
  textTargetAt,
  translation,
  worldBounds,
} from '../src/core';
import { createGraphicsPeerLab } from './helpers/peer-lab';

const label: ShapeLabel = {
  content: 'Connection',
  fontSize: 20,
  fontFamily: 'sans',
  width: 100,
  height: 30,
};
const connector = (): ShapeItem<'connector'> => ({
  id: 'link',
  type: 'connector',
  transform: IDENTITY,
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  appearance: { fill: 'transparent', stroke: 'black' },
  geometry: {
    start: { point: { x: 0, y: 0 } },
    end: { point: { x: 200, y: 0 } },
    route: 'straight',
    startHead: 'none',
    endHead: 'arrow',
  },
});

it('owns, freezes, copies, clears and undoes connector labels', () => {
  const editor = createGraphicsEditor([connector()]);
  try {
    editor.execute(setShapeLabelCommand, { id: 'link', label });
    const item = editor.document.items.link;
    if (item?.type !== 'connector') throw Error();
    expect(Object.isFrozen(item.geometry.label)).toBe(true);
    expect(
      parseFragment(JSON.stringify(copyFragment(editor.document, ['link'])))
        ?.scene.items.link
    ).toMatchObject({ geometry: { label } });
    expect(editor.hitTest({ x: 100, y: 12 })).toBe('link');
    expect(textTargetAt(editor.document, { x: 100, y: 12 })).toBe('link');
    expect(
      connectorDefinition.intersectsBox?.(item, IDENTITY, {
        x: 99,
        y: 10,
        width: 2,
        height: 2,
      })
    ).toBe(true);
    expect(connectorDefinition.bounds(item).height).toBeGreaterThanOrEqual(30);
    editor.execute(setShapeLabelCommand, { id: 'link' });
    expect(editor.document.items.link).toEqual(connector());
    editor.undo();
    expect(editor.document.items.link).toEqual(item);
  } finally {
    editor.dispose();
  }
});

it.each([
  'straight',
  'stepped',
  'smooth',
] as const)('centers labels on a %s route', (route) => {
  const item = connector();
  const layout = shapeLabelLayout({
    ...item,
    geometry: { ...item.geometry, route, label },
  })!;
  expect(layout.transform[4] + layout.geometry.width / 2).toBeCloseTo(100);
  expect(layout.transform[5] + layout.geometry.height / 2).toBeCloseTo(0);
});

it('uses the visible midpoint when a bound target moves', () => {
  const item = connector();
  const box: ShapeItem<'rectangle'> = {
    id: 'box',
    type: 'rectangle',
    transform: translation(300, -50),
    placement: { parentId: 'scene-root', sortKey: 'a1' },
    appearance: { fill: 'transparent', stroke: 'black' },
    geometry: { width: 100, height: 100 },
  };
  const scene = createScene([
    {
      ...item,
      geometry: {
        ...item.geometry,
        label,
        end: {
          point: { x: 200, y: 0 },
          binding: { targetId: 'box', anchor: 'left' },
        },
      },
    },
    box,
  ]);
  const projected = shapeProjection(scene, 'link').item;
  if (projected?.type !== 'connector') throw Error();
  expect(shapeLabelLayout(projected)!.transform[4]).toBeCloseTo(100);
  const moved = shapeProjection(scene, 'link', {
    box: { ...box, transform: translation(500, -50) },
  }).item;
  if (moved?.type !== 'connector') throw Error();
  expect(shapeLabelLayout(moved)!.transform[4]).toBeCloseTo(200);
});

it('rejects invalid connector labels at the geometry boundary', () => {
  for (const invalid of [
    { ...label, width: NaN },
    { ...label, height: -1 },
    { ...label, content: 3 },
  ]) {
    expect(
      connectorDefinition.validateGeometry({
        ...connector().geometry,
        label: invalid,
      })
    ).toBe(false);
  }
});

it('resizes route geometry instead of treating a fixed-size label as scalable', () => {
  const item = connector();
  const labeled = {
    ...item,
    geometry: {
      ...item.geometry,
      end: { point: { x: 20, y: 0 } },
      endHead: 'none' as const,
      label,
    },
  };
  expect(connectorDefinition.bounds(labeled).width).toBe(100);
  const resized = connectorDefinition.resize(labeled, {
    x: 0,
    y: 0,
    width: 200,
    height: 30,
  });
  expect(resized.geometry.end.point.x).toBeCloseTo(120);
  expect(connectorDefinition.bounds(resized).x).toBeCloseTo(-80);
  expect(connectorDefinition.bounds(resized).width).toBeCloseTo(200);
});

it('keeps the opposite visible edge anchored while resizing a labeled connector', () => {
  const item = connector();
  const editor = createGraphicsEditor([
    {
      ...item,
      geometry: {
        ...item.geometry,
        end: { point: { x: 20, y: 0 } },
        endHead: 'none',
        label,
      },
    },
  ]);
  try {
    editor.select('link');
    const before = worldBounds(editor.document, 'link');
    editor.beginTransform(
      'link',
      { x: before.x + before.width, y: before.y + before.height / 2 },
      'e'
    );
    editor.updateTransform({
      x: before.x + before.width + 100,
      y: before.y + before.height / 2,
    });
    editor.commitTransform();
    const after = worldBounds(editor.document, 'link');
    expect(after.x).toBeCloseTo(before.x);
    expect(after.width).toBeCloseTo(before.width + 100);
    const resized = editor.document.items.link;
    if (resized?.type !== 'connector') throw Error();
    expect(resized.geometry.start.point.y).toBeCloseTo(
      resized.geometry.end.point.y
    );
  } finally {
    editor.dispose();
  }
});

it('creates the missing route axis when a labeled connector gains height', () => {
  const item = connector();
  const editor = createGraphicsEditor([
    {
      ...item,
      geometry: {
        ...item.geometry,
        end: { point: { x: 20, y: 0 } },
        endHead: 'none',
        label,
      },
    },
  ]);
  try {
    editor.select('link');
    const before = worldBounds(editor.document, 'link');
    editor.beginTransform(
      'link',
      { x: before.x + before.width / 2, y: before.y + before.height },
      's'
    );
    editor.updateTransform({
      x: before.x + before.width / 2,
      y: before.y + before.height + 20,
    });
    editor.commitTransform();
    const after = worldBounds(editor.document, 'link');
    expect(after.y).toBeCloseTo(before.y);
    expect(after.height).toBeCloseTo(before.height + 20);
  } finally {
    editor.dispose();
  }
});

it('clamps below-label shrinking at the fixed label size without moving the opposite edge', () => {
  const item = connector();
  const editor = createGraphicsEditor([
    {
      ...item,
      geometry: {
        ...item.geometry,
        end: { point: { x: 20, y: 0 } },
        endHead: 'none',
        label,
      },
    },
  ]);
  try {
    editor.select('link');
    const before = worldBounds(editor.document, 'link');
    editor.beginTransform(
      'link',
      { x: before.x + before.width, y: before.y + before.height / 2 },
      'e'
    );
    editor.updateTransform({
      x: before.x + before.width - 20,
      y: before.y + before.height / 2,
    });
    editor.commitTransform();
    expect(worldBounds(editor.document, 'link')).toEqual(before);
  } finally {
    editor.dispose();
  }
});

it('resizes circular endpoint heads by their visible bounds', () => {
  const item = connector();
  const editor = createGraphicsEditor([
    {
      ...item,
      geometry: {
        ...item.geometry,
        startHead: 'circle',
        endHead: 'circle',
      },
    },
  ]);
  try {
    editor.select('link');
    const before = worldBounds(editor.document, 'link');
    editor.beginTransform(
      'link',
      { x: before.x + before.width, y: before.y + before.height / 2 },
      'e'
    );
    editor.updateTransform({
      x: before.x + before.width + 100,
      y: before.y + before.height / 2,
    });
    editor.commitTransform();
    const after = worldBounds(editor.document, 'link');
    expect(after.x).toBeCloseTo(before.x);
    expect(after.width).toBeCloseTo(before.width + 100);
  } finally {
    editor.dispose();
  }
});

it('maps a group resize handle into a quarter-turned connector frame', () => {
  const item = connector();
  const editor = createGraphicsEditor(
    createScene([
      {
        id: 'group',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: IDENTITY,
      },
      {
        ...item,
        placement: { parentId: 'group', sortKey: 'a0' },
        transform: multiply(translation(100, 100), rotation(Math.PI / 2)),
        geometry: {
          ...item.geometry,
          end: { point: { x: 20, y: 0 } },
          endHead: 'none',
          label,
        },
      },
    ])
  );
  try {
    editor.select('group');
    const before = worldBounds(editor.document, 'group');
    editor.beginTransform(
      'group',
      { x: before.x + before.width, y: before.y + before.height / 2 },
      'e'
    );
    editor.updateTransform({
      x: before.x + before.width - 20,
      y: before.y + before.height / 2,
    });
    const after = worldBounds(
      editor.document,
      'group',
      editor.getSession().transform!.nodes
    );
    expect(after.x).toBeCloseTo(before.x);
    expect(after.width).toBeCloseTo(before.width);
  } finally {
    editor.dispose();
  }
});

it('round trips connector labels through Loro and undo', () => {
  const lab = createGraphicsPeerLab(createScene([connector()]));
  try {
    lab.setConnected(false);
    const a = lab.peers[0]!.editor,
      b = lab.peers[1]!.editor;
    const before = b.document.items.link;
    a.execute(setShapeLabelCommand, { id: 'link', label });
    lab.syncNow();
    expect(b.document.items.link).toMatchObject({ geometry: { label } });
    a.undo();
    lab.syncNow();
    expect(b.document.items.link).toEqual(before);
  } finally {
    lab.dispose();
  }
});
