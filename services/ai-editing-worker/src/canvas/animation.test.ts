import { createScene } from '@macro-inc/graphics';
import { describe, expect, it } from 'vitest';
import {
  type CanvasPresentation,
  canvasAnimation,
  runCanvasAnimation,
} from './animation';
import { dependencies } from './dependencies';
import { prepareCanvasEdit } from './operations';
import type { CanvasOp } from './schema';

describe('one batch concurrent presentation lanes', () => {
  it('presents three real regions together and clears all on cancellation', async () => {
    const before = createScene();
    const ops: CanvasOp[] = [0, 400, 800].map((x, index) => ({
      kind: 'create',
      id: `box-${index}`,
      type: 'rectangle',
      x,
      y: 0,
      width: 100,
      height: 80,
    }));
    const after = prepareCanvasEdit(before, ops);
    const steps = canvasAnimation(
      before,
      after,
      dependencies(before, after, ops)
    );
    const controller = new AbortController();
    const values: (CanvasPresentation | undefined)[] = [];
    await expect(
      runCanvasAnimation(
        steps,
        (value) => values.push(value),
        controller.signal,
        () => {},
        async () => {
          controller.abort();
        }
      )
    ).rejects.toThrow();
    expect(values[0]?.lanes).toHaveLength(3);
    expect(values[0]?.lanes?.flatMap((lane) => lane.itemIds).sort()).toEqual([
      'box-0',
      'box-1',
      'box-2',
    ]);
    expect(values[0]?.lanes?.every((lane) => lane.cursor !== null)).toBe(true);
    expect(values.at(-1)).toBeUndefined();
    expect(Object.keys(before.items)).toHaveLength(1);
  });
  it('keeps bound arrows with their changed nodes and anchors cursors in real regions', () => {
    const before = prepareCanvasEdit(createScene(), [
      ...[500, 1000, 1500].map(
        (x, index): CanvasOp => ({
          kind: 'create',
          id: `node-${index}`,
          type: 'rectangle',
          x,
          y: 400,
          width: 100,
          height: 80,
        })
      ),
      ...[0, 1].map(
        (index): CanvasOp => ({
          kind: 'connect',
          id: `arrow-${index}`,
          route: 'straight',
          start: {
            point: { x: 600 + index * 500, y: 440 },
            binding: { targetId: `node-${index}`, anchor: 'right' },
          },
          end: {
            point: { x: 1000 + index * 500, y: 440 },
            binding: { targetId: `node-${index + 1}`, anchor: 'left' },
          },
        })
      ),
    ]);
    const ops: CanvasOp[] = [
      { kind: 'move', ids: ['node-0', 'node-1', 'node-2'], dx: 0, dy: 20 },
    ];
    const after = prepareCanvasEdit(before, ops);
    const first = canvasAnimation(
      before,
      after,
      dependencies(before, after, ops)
    )[0];
    if (first.kind !== 'awareness') throw new Error('Missing presentation');
    expect(first.value.lanes).toHaveLength(3);
    expect(first.value.lanes?.map((lane) => lane.cursor)).toEqual([
      { x: 500, y: 400 },
      { x: 1000, y: 400 },
      { x: 1500, y: 400 },
    ]);
    expect(
      first.value.lanes?.every((lane) =>
        lane.itemIds.some((id) => id.startsWith('node-'))
      )
    ).toBe(true);
    expect(first.value.preview?.shapes).toHaveLength(5);
  });
  it('keeps descendants of a group together', () => {
    const before = prepareCanvasEdit(createScene(), [
      { kind: 'create', id: 'a', type: 'rectangle', x: 0, y: 0 },
      { kind: 'create', id: 'b', type: 'ellipse', x: 400, y: 0 },
      { kind: 'group', id: 'g', ids: ['a', 'b'] },
    ]);
    const ops: CanvasOp[] = [{ kind: 'move', ids: ['g'], dx: 0, dy: 20 }];
    const after = prepareCanvasEdit(before, ops);
    const first = canvasAnimation(
      before,
      after,
      dependencies(before, after, ops)
    )[0];
    if (first.kind !== 'awareness') throw new Error('Missing presentation');
    expect(first.value.lanes).toBeUndefined();
    expect(first.value.preview?.shapes.map((shape) => shape.id).sort()).toEqual(
      ['a', 'b']
    );
  });
});
