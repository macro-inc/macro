import { afterEach, expect, it, vi } from 'vitest';
import {
  children,
  createGraphicsEditorFromBackend,
  createScene,
  freezeDocument,
  type GraphicsEditor,
  IDENTITY,
  translation,
  worldMatrix,
} from '../src/core';
import {
  createGraphicsPeerLab,
  createLoroGraphicsBackend,
  createLoroSeed,
} from '../src/loro';

const seed = () =>
  createScene([
    {
      id: 'a',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(10, 20),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(130, 30),
      geometry: { width: 90, height: 70 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
    {
      id: 'g',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a2' },
      transform: translation(100, 100),
    },
  ]);
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});
function setup(document = seed()) {
  const lab = createGraphicsPeerLab(document);
  disposers.push(lab.dispose);
  lab.setConnected(false);
  return { lab, a: lab.peers[0]!.editor, b: lab.peers[1]!.editor };
}
function move(editor: GraphicsEditor, id: string, dx: number) {
  editor.select(id);
  editor.beginTransform(id, { x: 0, y: 0 });
  editor.updateTransform({ x: dx, y: 0 });
  editor.commitTransform();
}
function converge(a: GraphicsEditor, b: GraphicsEditor) {
  expect(a.document).toEqual(b.document);
  expect(() => freezeDocument(a.document)).not.toThrow();
}
it('merges move and restyle, and local undo preserves remote style', () => {
  const { lab, a, b } = setup();
  move(a, 'a', 50);
  b.select('a');
  b.setSelectionAppearance({ fill: 'green' });
  expect(lab.status().pending).toBe(2);
  lab.syncNow();
  converge(a, b);
  expect(worldMatrix(a.document, 'a')[4]).toBe(60);
  expect(a.document.items.a).toMatchObject({ appearance: { fill: 'green' } });
  a.undo();
  lab.syncNow();
  converge(a, b);
  expect(worldMatrix(a.document, 'a')[4]).toBe(10);
  expect(a.document.items.a).toMatchObject({ appearance: { fill: 'green' } });
  a.redo();
  lab.syncNow();
  converge(a, b);
  expect(worldMatrix(a.document, 'a')[4]).toBe(60);
});
it('retains native same-property undo semantics explicitly', () => {
  const { lab, a, b } = setup();
  a.select('a');
  a.setSelectionAppearance({ fill: 'green' });
  lab.syncNow();
  b.select('a');
  b.setSelectionAppearance({ fill: 'yellow' });
  lab.syncNow();
  a.undo();
  lab.syncNow();
  converge(a, b);
  expect(a.document.items.a).toMatchObject({ appearance: { fill: 'red' } });
  a.redo();
  lab.syncNow();
  converge(a, b);
  expect(a.document.items.a).toMatchObject({ appearance: { fill: 'yellow' } });
});
it('concurrent inserts and layer moves converge without duplicate core keys', () => {
  const { lab, a, b } = setup();
  for (const [editor, id] of [
    [a, 'new-a'],
    [b, 'new-b'],
  ] as const) {
    editor.beginRectangle({ x: 0, y: 0 });
    editor.updateRectangle({ x: 60, y: 60 });
    editor.commitRectangle(id, { fill: 'red', stroke: 'black' });
    editor.select('a');
    editor.reorderSelection('front');
  }
  lab.syncNow();
  converge(a, b);
  expect(children(a.document)).toHaveLength(5);
  a.reorderSelection('back');
  lab.syncNow();
  converge(a, b);
  expect(children(a.document)[0]).toBe('a');
});
it('group, ungroup and undo keep hierarchy and world poses', () => {
  const { lab, a, b } = setup();
  a.select('a');
  a.toggleSelection('b');
  a.groupSelection('pair');
  lab.syncNow();
  converge(a, b);
  expect(children(b.document, 'pair')).toEqual(['a', 'b']);
  expect(worldMatrix(b.document, 'a')).toEqual(translation(10, 20));
  a.ungroupSelection();
  lab.syncNow();
  converge(a, b);
  expect(a.document.items.pair).toBeUndefined();
  a.undo();
  lab.syncNow();
  converge(a, b);
  expect(children(b.document, 'pair')).toEqual(['a', 'b']);
});
it('opposite reparenting converges to an acyclic scene', () => {
  const doc = seed();
  const { lab, a, b } = setup(
    createScene([
      ...Object.values(doc.items).filter((n) => n.type !== 'surface'),
      {
        id: 'h',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a3' },
        transform: IDENTITY,
      },
    ])
  );
  a.reparent('g', 'h');
  b.reparent('h', 'g');
  lab.syncNow();
  converge(a, b);
  expect(a.document.items.g).toBeDefined();
  expect(a.document.items.h).toBeDefined();
});
it('concurrent reparent/move uses the winning pose in its recorded frame', () => {
  const { lab, a, b } = setup();
  a.reparent('a', 'g');
  move(b, 'a', 50);
  lab.syncNow();
  converge(a, b);
  expect(a.document.items.a).toMatchObject({ placement: { parentId: 'g' } });
  expect([10, 60]).toContain(worldMatrix(a.document, 'a')[4]);
});
it('deleting a group while another peer extracts a child converges', () => {
  const { lab, a, b } = setup();
  a.reparent('a', 'g');
  lab.syncNow();
  a.select('g');
  a.deleteSelection();
  b.reparent('a', 'scene-root');
  lab.syncNow();
  converge(a, b);
  expect(a.document.items.g).toBeUndefined();
  // Loro keeps a concurrently extracted child alive.
  expect(a.document.items.a).toMatchObject({
    placement: { parentId: 'scene-root' },
  });
});
it('remote changes cancel previews and never enter the other peer history', () => {
  const { lab, a, b } = setup();
  b.select('a');
  b.beginTransform('a', { x: 0, y: 0 });
  b.updateTransform({ x: 100, y: 0 });
  move(a, 'a', 50);
  lab.syncNow();
  expect(b.getSession().transform).toBeUndefined();
  expect(b.getSession().canUndo).toBe(false);
  expect(b.commitTransform()).toBe(false);
  converge(a, b);
});
it('transport queues offline edits, honors latency and disposes timers', () => {
  vi.useFakeTimers();
  const { lab, a, b } = setup();
  move(a, 'a', 20);
  vi.advanceTimersByTime(2000);
  expect(worldMatrix(b.document, 'a')[4]).toBe(10);
  lab.setLatency(400);
  lab.setConnected(true);
  vi.advanceTimersByTime(399);
  expect(lab.status().pending).toBe(1);
  vi.advanceTimersByTime(1);
  converge(a, b);
  expect(lab.status().pending).toBe(0);
  move(a, 'a', 20);
  lab.dispose();
  vi.runAllTimers();
});
it('duplicate and reversed deliveries converge and do not echo', () => {
  const bytes = createLoroSeed(seed());
  const first = createLoroGraphicsBackend(bytes, '3', 'scene-root'),
    second = createLoroGraphicsBackend(bytes, '4', 'scene-root');
  const a = createGraphicsEditorFromBackend(first),
    b = createGraphicsEditorFromBackend(second);
  disposers.push(() => {
    a.dispose();
    b.dispose();
    first.dispose();
    second.dispose();
  });
  const messages: Uint8Array[] = [];
  first.subscribeUpdates((bytes) => messages.push(bytes));
  const echo = vi.fn();
  second.subscribeUpdates(echo);
  move(a, 'a', 10);
  move(a, 'b', 20);
  second.receive(messages[1]!);
  second.receive(messages[0]!);
  second.receive(messages[1]!);
  converge(a, b);
  expect(echo).not.toHaveBeenCalled();
});

it('uses captured world pose when a later concurrent move wins under a new parent', () => {
  const { lab, a, b } = setup();
  a.reparent('a', 'g');
  // Advance this replica's Lamport clock while still disconnected.
  for (let i = 0; i < 8; i++) {
    b.select('b');
    b.setSelectionAppearance({ fill: `color-${i}` });
  }
  move(b, 'a', 50);
  lab.syncNow();
  converge(a, b);
  expect(worldMatrix(a.document, 'a')).toEqual(translation(60, 20));
  expect(lab.peers[0]!.backend.getFrameConflicts()).toContain('a');
  move(a, 'g', 40);
  lab.syncNow();
  converge(a, b);
  expect(worldMatrix(a.document, 'a')).toEqual(translation(60, 20));
  move(a, 'a', 10);
  lab.syncNow();
  expect(lab.peers[0]!.backend.getFrameConflicts()).not.toContain('a');
  move(a, 'g', 20);
  lab.syncNow();
  converge(a, b);
  expect(worldMatrix(a.document, 'a')).toEqual(translation(90, 20));
});

it('delete wins over concurrent editing; native undo restores pre-delete data', () => {
  const { lab, a, b } = setup();
  a.select('a');
  a.deleteSelection();
  b.select('a');
  b.setSelectionAppearance({ fill: 'green' });
  lab.syncNow();
  converge(a, b);
  expect(a.document.items.a).toBeUndefined();
  a.undo();
  lab.syncNow();
  converge(a, b);
  expect(a.document.items.a).toMatchObject({ appearance: { fill: 'red' } });
});

it('rejects unsupported proposals before touching Loro or local history', () => {
  const { lab, a, b } = setup();
  const backend = lab.peers[0]!.backend;
  const before = backend.getDocument();
  const node = before.items.a!;
  if (node.type !== 'rectangle') throw new Error('Missing fixture');
  const changed = {
    ...before,
    items: {
      ...before.items,
      b: { ...before.items.b!, transform: translation(999, 999) },
      a: { ...node, type: 'ellipse' as const },
    },
  };
  expect(() => backend.commit(changed)).toThrow('immutable');
  expect(backend.getDocument()).toBe(before);
  expect(a.getSession().canUndo).toBe(false);
  move(a, 'b', 30);
  lab.syncNow();
  converge(a, b);
  expect(worldMatrix(b.document, 'a')).toEqual(translation(10, 20));
  expect(worldMatrix(b.document, 'b')).toEqual(translation(160, 30));
});
