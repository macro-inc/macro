import { afterEach, expect, it, vi } from 'vitest';
import { createScene, translation } from '../src/core';
import { createGraphicsPeerLab, currentPresencePreview } from '../src/loro';
import type { PresencePacket } from '../src/loro/presence';

const dispose: (() => void)[] = [];
afterEach(() => {
  dispose.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  const lab = createGraphicsPeerLab(
    createScene([
      {
        id: 'g',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: translation(100, 100),
      },
      {
        id: 'a',
        type: 'rectangle',
        placement: { parentId: 'g', sortKey: 'a0' },
        transform: translation(10, 20),
        geometry: { width: 100, height: 80 },
        appearance: { fill: 'red', stroke: 'black' },
      },
      {
        id: 'b',
        type: 'ellipse',
        placement: { parentId: 'scene-root', sortKey: 'a1' },
        transform: translation(230, 40),
        geometry: { width: 70, height: 70 },
        appearance: { fill: 'red', stroke: 'black' },
      },
    ])
  );
  dispose.push(lab.dispose);
  return { lab, a: lab.peers[0]!, b: lab.peers[1]! };
}
it('shares cursor and selection without any document update, local selection or history change', () => {
  const { lab, a, b } = setup();
  const beforeA = a.editor.document,
    beforeB = b.editor.document;
  const clock = a.backend.getClock();
  a.editor.select('g');
  a.presence.setCursor({ x: 150, y: 160 });
  vi.advanceTimersByTime(50);
  expect(b.presence.getRemote()[0]).toMatchObject({
    name: 'Alice',
    cursor: { x: 150, y: 160 },
    selectedIds: ['g'],
    preview: null,
  });
  expect(b.editor.getSession().selectedIds).toEqual([]);
  expect(a.editor.document).toBe(beforeA);
  expect(b.editor.document).toBe(beforeB);
  expect(a.backend.getClock()).toEqual(clock);
  expect(a.editor.getSession().canUndo).toBe(false);
  expect(lab.status()).toMatchObject({ pending: 0, delivered: 0 });
});
it('captures nested pending moves in world space and clears on cancel', () => {
  const { lab, a, b } = setup();
  a.editor.select('g');
  a.editor.beginTransform('g', { x: 0, y: 0 });
  a.editor.updateTransform({ x: 50, y: 30 });
  vi.advanceTimersByTime(50);
  const state = b.presence.getRemote()[0]!;
  expect(currentPresencePreview(state, b.backend.getClock())).toMatchObject({
    kind: 'move',
    shapes: [{ id: 'a', world: [1, 0, 0, 1, 160, 150] }],
  });
  expect(b.editor.document.items.g).toMatchObject({
    transform: [1, 0, 0, 1, 100, 100],
  });
  a.editor.cancelTransform();
  vi.advanceTimersByTime(50);
  expect(b.presence.getRemote()[0]!.preview).toBeNull();
  expect(lab.status().delivered).toBe(0);
});
it.each(['rectangle', 'ellipse'] as const)(
  'shares a pending %s without creating a remote item',
  (kind) => {
    const { a, b } = setup();
    a.editor.beginShape(kind, { x: 20, y: 30 });
    a.editor.updateShape({ x: 100, y: 90 });
    vi.advanceTimersByTime(50);
    expect(b.presence.getRemote()[0]?.preview).toMatchObject({
      kind: 'draw',
      shapes: [{ kind, width: 80, height: 60, world: [1, 0, 0, 1, 20, 30] }],
    });
    expect(Object.keys(b.editor.document.items)).toHaveLength(4);
    a.editor.cancelShape();
    vi.advanceTimersByTime(50);
    expect(b.presence.getRemote()[0]?.preview).toBeNull();
  }
);
it('shares box selection and resize/rotation action kinds', () => {
  const { a, b } = setup();
  a.editor.beginBoxSelection({ x: 0, y: 0 });
  a.editor.updateBoxSelection({ x: 300, y: 300 });
  vi.advanceTimersByTime(50);
  expect(b.presence.getRemote()[0]?.preview).toMatchObject({
    kind: 'marquee',
    box: { x: 0, y: 0, width: 300, height: 300 },
  });
  a.editor.cancelTransform();
  a.editor.select('b');
  a.editor.beginTransform('b', { x: 300, y: 110 }, 'se');
  a.editor.updateTransform({ x: 320, y: 130 });
  vi.advanceTimersByTime(50);
  expect(b.presence.getRemote()[0]?.preview?.kind).toBe('resize');
  a.editor.cancelTransform();
  a.editor.beginTransform('b', { x: 265, y: 0 }, 'rotate');
  a.editor.updateTransform({ x: 400, y: 75 });
  vi.advanceTimersByTime(50);
  expect(b.presence.getRemote()[0]?.preview?.kind).toBe('rotate');
});
it('coalesces pending presence and drops it while offline instead of replaying a gesture', () => {
  const { lab, a, b } = setup();
  lab.setLatency(500);
  a.editor.select('a');
  a.editor.beginTransform('a', { x: 0, y: 0 });
  for (let i = 0; i < 100; i++) {
    a.editor.updateTransform({ x: i, y: 0 });
    a.presence.setCursor({ x: i, y: 0 });
  }
  a.editor.cancelTransform();
  vi.advanceTimersByTime(500);
  expect(b.presence.getRemote()[0]).toMatchObject({
    cursor: { x: 99, y: 0 },
    preview: null,
  });
  lab.setConnected(false);
  expect(b.presence.getRemote()).toEqual([]);
  a.editor.beginTransform('a', { x: 0, y: 0 });
  a.editor.updateTransform({ x: 300, y: 0 });
  vi.advanceTimersByTime(1000);
  expect(b.presence.getRemote()).toEqual([]);
  a.editor.cancelTransform();
  lab.syncNow();
  expect(b.presence.getRemote()).toEqual([]);
  lab.setConnected(true);
  vi.advanceTimersByTime(500);
  expect(b.presence.getRemote()[0]?.preview).toBeNull();
});
it('rejects a delayed preview after the committed document advances', () => {
  const { lab, a, b } = setup();
  a.editor.select('a');
  a.editor.beginTransform('a', { x: 0, y: 0 });
  a.editor.updateTransform({ x: 50, y: 0 });
  vi.advanceTimersByTime(50);
  const pending = b.presence.getRemote()[0]!;
  expect(currentPresencePreview(pending, b.backend.getClock())).not.toBeNull();
  a.editor.commitTransform();
  lab.syncNow();
  expect(currentPresencePreview(pending, b.backend.getClock())).toBeNull();
  expect(b.presence.getRemote()[0]?.preview).toBeNull();
  expect(a.editor.getSession().canUndo).toBe(true);
  expect(b.editor.getSession().canUndo).toBe(false);
});
it('ignores duplicated/out-of-order presence packets', () => {
  const { a, b } = setup();
  const packets: PresencePacket[] = [];
  a.presence.subscribeUpdates((packet) => packets.push(packet));
  a.presence.setCursor({ x: 10, y: 10 });
  a.presence.publish();
  a.presence.setCursor(null);
  b.presence.receive(packets[1]!);
  b.presence.receive(packets[0]!);
  b.presence.receive(packets[1]!);
  expect(b.presence.getRemote()[0]?.cursor).toBeNull();
});
it('debounces capture and encoding with a maximum wait during continuous movement', () => {
  const { a } = setup();
  const send = vi.fn();
  a.presence.subscribeUpdates(send);
  a.presence.setCursor({ x: 1, y: 0 });
  vi.advanceTimersByTime(30);
  a.presence.setCursor({ x: 2, y: 0 });
  vi.advanceTimersByTime(39);
  expect(send).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(send).toHaveBeenCalledTimes(1);
  send.mockClear();
  for (let i = 0; i < 10; i++) {
    a.presence.setCursor({ x: i, y: 0 });
    vi.advanceTimersByTime(10);
  }
  expect(send).toHaveBeenCalledTimes(1);
  a.presence.setCursor({ x: 99, y: 0 });
  a.presence.setCursor(null);
  expect(send).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(100);
  expect(send).toHaveBeenCalledTimes(2);
});
it('cleans up all heartbeat, transport and expiry timers', () => {
  const { lab, a, b } = setup();
  a.presence.setCursor({ x: 1, y: 2 });
  vi.advanceTimersByTime(50);
  expect(b.presence.getRemote()).toHaveLength(1);
  lab.dispose();
  expect(vi.getTimerCount()).toBe(0);
  a.presence.setCursor({ x: 3, y: 4 });
  expect(b.presence.getRemote()).toEqual([]);
});

it('expires an absent peer while heartbeats retain an idle connected selection', () => {
  const { a, b } = setup();
  a.editor.select('a');
  vi.advanceTimersByTime(61_000);
  expect(b.presence.getRemote()[0]?.selectedIds).toEqual(['a']);
  a.presence.dispose();
  vi.advanceTimersByTime(46_000);
  expect(b.presence.getRemote()).toEqual([]);
});
