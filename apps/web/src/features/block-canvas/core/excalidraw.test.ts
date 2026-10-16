import {
  children,
  createGraphicsEditor,
  drawableIds,
  pasteCommand,
} from '@macro-inc/graphics';
import { expect, it } from 'vitest';
import { importExcalidraw } from './excalidraw';
import { richTextPlainText } from './text-codec';

const wrap = (elements: unknown[], type = 'excalidraw/clipboard') =>
  JSON.stringify({ type, elements });

const shape = (overrides: Record<string, unknown>) => ({
  id: 'shape',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 100,
  groupIds: [],
  isDeleted: false,
  ...overrides,
});

it('rejects payloads that are not Excalidraw scenes', () => {
  expect(importExcalidraw('not json')).toBeUndefined();
  expect(
    importExcalidraw(JSON.stringify({ kind: 'macro-graphics-fragment' }))
  ).toBeUndefined();
  expect(importExcalidraw(wrap([]))).toBeUndefined();
  expect(
    importExcalidraw(JSON.stringify({ type: 'excalidraw' }))
  ).toBeUndefined();
});

it('accepts both file and clipboard envelopes', () => {
  expect(importExcalidraw(wrap([shape({})], 'excalidraw'))?.imported).toBe(1);
  expect(
    importExcalidraw(wrap([shape({})], 'excalidraw/clipboard'))?.imported
  ).toBe(1);
});

it('maps shapes, position/rotation, fill, stroke and corner radius', () => {
  const result = importExcalidraw(
    wrap([
      shape({
        id: 'rect',
        x: 100,
        y: 200,
        width: 40,
        height: 20,
        backgroundColor: '#a5d8ff',
        strokeColor: '#1971c2',
        strokeWidth: 4,
        strokeStyle: 'dashed',
        opacity: 50,
        roundness: { type: 3, value: 8 },
      }),
      shape({ id: 'oval', type: 'ellipse', x: 10, y: 10 }),
    ])
  );
  const scene = result!.fragment.scene;
  const rect = scene.items.rect!;
  expect(rect.type).toBe('rectangle');
  if (rect.type !== 'rectangle') throw new Error('unreachable');
  // angle 0 keeps the top-left translation.
  expect(rect.transform[4]).toBe(100);
  expect(rect.transform[5]).toBe(200);
  expect(rect.appearance).toMatchObject({
    fill: '#a5d8ff',
    stroke: '#1971c2',
    strokeWidth: 4,
    strokeStyle: 'dashed',
    opacity: 0.5,
    cornerRadius: 8,
  });
  expect(scene.items.oval!.type).toBe('ellipse');
});

it('rotates around the element center like Excalidraw', () => {
  const result = importExcalidraw(
    wrap([
      shape({
        id: 'r',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        angle: Math.PI / 2,
      }),
    ])
  );
  const r = result!.fragment.scene.items.r!;
  if (r.type === 'surface') throw new Error('unreachable');
  // A quarter turn about the center maps local (0,0) to world (100,0).
  expect(Math.round(r.transform[4])).toBe(100);
  expect(Math.round(r.transform[5])).toBe(0);
});

it('converts standalone text and folds container-bound text into a label', () => {
  const result = importExcalidraw(
    wrap([
      shape({
        id: 'note',
        type: 'text',
        text: 'Hello\nworld',
        fontSize: 24,
        textAlign: 'center',
      }),
      shape({ id: 'box', width: 120, height: 60 }),
      shape({
        id: 'caption',
        type: 'text',
        text: 'Inside',
        containerId: 'box',
        fontSize: 16,
      }),
    ])
  );
  const scene = result!.fragment.scene;
  const note = scene.items.note!;
  if (note.type !== 'text') throw new Error('unreachable');
  expect(note.geometry.fontSize).toBe(24);
  expect(richTextPlainText(note.geometry.content)).toBe('Hello\nworld');
  // The container text is consumed as a label, not a standalone item.
  expect(scene.items.caption).toBeUndefined();
  const box = scene.items.box!;
  if (box.type !== 'rectangle') throw new Error('unreachable');
  expect(richTextPlainText(box.geometry.label!.content)).toBe('Inside');
});

it('converts arrows to connectors with heads and only keeps resolvable bindings', () => {
  const result = importExcalidraw(
    wrap([
      shape({ id: 'target', width: 50, height: 50 }),
      shape({
        id: 'link',
        type: 'arrow',
        x: 10,
        y: 10,
        points: [
          [0, 0],
          [40, 30],
        ],
        startBinding: { elementId: 'target' },
        endBinding: { elementId: 'missing' },
      }),
    ])
  );
  const connector = result!.fragment.scene.items.link!;
  if (connector.type !== 'connector') throw new Error('unreachable');
  expect(connector.geometry.endHead).toBe('arrow');
  expect(connector.geometry.start.point).toEqual({ x: 0, y: 0 });
  expect(connector.geometry.end.point).toEqual({ x: 40, y: 30 });
  expect(connector.geometry.start.binding?.targetId).toBe('target');
  expect(connector.geometry.end.binding).toBeUndefined();
});

it('converts freedraw strokes to pencil samples with pressure', () => {
  const result = importExcalidraw(
    wrap([
      shape({
        id: 'ink',
        type: 'freedraw',
        points: [
          [0, 0],
          [5, 5],
          [10, 2],
        ],
        pressures: [0.1, 0.5, 0.9],
        simulatePressure: false,
      }),
    ])
  );
  const ink = result!.fragment.scene.items.ink!;
  if (ink.type !== 'pencil') throw new Error('unreachable');
  expect(ink.geometry.simulatePressure).toBe(false);
  expect(ink.geometry.points).toEqual([
    [0, 0, 0.1],
    [5, 5, 0.5],
    [10, 2, 0.9],
  ]);
});

it('rebuilds nested groups into the local-transform tree', () => {
  const result = importExcalidraw(
    wrap([
      shape({ id: 'a', groupIds: ['inner', 'outer'] }),
      shape({ id: 'b', groupIds: ['inner', 'outer'] }),
      shape({ id: 'c', groupIds: ['outer'] }),
      shape({ id: 'loose', groupIds: [] }),
    ])
  );
  const scene = result!.fragment.scene;
  expect(scene.items.outer!.type).toBe('group');
  expect(scene.items.inner!.type).toBe('group');
  // outer and loose sit at the root; inner nests under outer; a/b under inner.
  expect([...children(scene)].sort()).toEqual(['loose', 'outer']);
  expect(children(scene, 'outer')).toContain('inner');
  expect(children(scene, 'outer')).toContain('c');
  expect([...children(scene, 'inner')].sort()).toEqual(['a', 'b']);
});

it('approximates diamonds and drops unsupported elements', () => {
  const result = importExcalidraw(
    wrap([
      shape({ id: 'd', type: 'diamond' }),
      shape({ id: 'pic', type: 'image', fileId: 'x' }),
      shape({ id: 'frame', type: 'frame' }),
    ])
  );
  expect(result!.imported).toBe(1);
  expect(result!.approximated).toBe(1);
  expect(result!.skipped).toBe(2);
  expect(result!.fragment.scene.items.d!.type).toBe('rectangle');
});

it('produces a fragment the paste command can insert', () => {
  const result = importExcalidraw(
    wrap([
      shape({ id: 'a', groupIds: ['g'] }),
      shape({ id: 'b', type: 'ellipse', groupIds: ['g'] }),
    ])
  );
  const editor = createGraphicsEditor();
  let next = 0;
  editor.execute(pasteCommand, {
    fragment: result!.fragment,
    createId: () => `paste-${next++}`,
  });
  expect(drawableIds(editor.document)).toHaveLength(2);
  editor.dispose();
});

it.each(['arrow', 'line'])(
  'imports bound text as a native %s connector label',
  (type) => {
    const result = importExcalidraw(
      wrap([
        shape({
          id: 'link',
          type,
          points: [
            [0, 0],
            [200, 50],
          ],
          groupIds: ['g'],
        }),
        shape({
          id: 'caption',
          type: 'text',
          containerId: 'link',
          text: 'Connects\nto',
          fontSize: 18,
          fontFamily: 3,
          width: 90,
          height: 45,
          textAlign: 'center',
        }),
      ])
    )!;
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.fragment.scene.items.caption).toBeUndefined();
    const item = result.fragment.scene.items.link;
    if (item?.type !== 'connector') throw Error();
    expect(item.geometry.label).toMatchObject({
      fontSize: 18,
      fontFamily: 'mono',
      width: 90,
      height: 45,
    });
    expect(richTextPlainText(item.geometry.label!.content)).toBe(
      'Connects\nto'
    );
    const editor = createGraphicsEditor();
    try {
      let next = 0;
      editor.execute(pasteCommand, {
        fragment: result.fragment,
        createId: () => `label-${next++}`,
      });
      const copied = editor.document.items[drawableIds(editor.document)[0]!];
      expect(copied).toMatchObject({
        type: 'connector',
        geometry: { label: item.geometry.label },
      });
    } finally {
      editor.dispose();
    }
  }
);

it.each([
  { roundness: { type: 2 }, expected: 'smooth' },
  { elbowed: true, expected: 'stepped' },
  { expected: 'straight' },
])(
  'keeps $expected routing only when both imported bindings resolve',
  ({ expected, ...route }) => {
    for (const [start, end, doublyBound] of [
      [undefined, undefined, false],
      ['a', undefined, false],
      [undefined, 'b', false],
      ['a', 'missing', false],
      ['a', 'unsupported', false],
      ['a', 'b', true],
    ] as const) {
      const result = importExcalidraw(
        wrap([
          shape({ id: 'a' }),
          shape({ id: 'b', x: 300 }),
          shape({ id: 'unsupported', type: 'image' }),
          shape({
            id: 'link',
            type: 'arrow',
            points: [
              [0, 0],
              [200, 50],
            ],
            startBinding: start ? { elementId: start } : null,
            endBinding: end ? { elementId: end } : null,
            ...route,
          }),
        ])
      )!;
      expect(result.fragment.scene.items.link).toMatchObject({
        geometry: { route: doublyBound ? expected : 'straight' },
      });
    }
  }
);

it('keeps text standalone when its connector cannot be imported', () => {
  const result = importExcalidraw(
    wrap([
      shape({ id: 'link', type: 'arrow', points: [] }),
      shape({
        id: 'caption',
        type: 'text',
        containerId: 'link',
        text: 'Still here',
      }),
    ])
  )!;
  expect(result.fragment.scene.items.caption?.type).toBe('text');
});
