import { createScene } from '@macro-inc/graphics';
import { describe, expect, it } from 'vitest';
import {
  CanvasScheduler,
  conflicts,
  dependencies,
  dependencyState,
} from './dependencies';
import { prepareCanvasEdit } from './operations';
import type { CanvasOp } from './schema';

const box = (id: string, x: number): CanvasOp => ({
  kind: 'create',
  id,
  type: 'rectangle',
  x,
  y: 0,
  width: 100,
  height: 100,
});
describe('Canvas dependency scheduling', () => {
  it('allows independent regions but reserves overlapping newly allocated geometry', () => {
    const scene = createScene();
    const opsA = [box('a', 0)];
    const a = dependencies(scene, prepareCanvasEdit(scene, opsA), opsA);
    const opsB = [box('b', 300)];
    const b = dependencies(scene, prepareCanvasEdit(scene, opsB), opsB);
    const opsC = [box('c', 50)];
    const c = dependencies(scene, prepareCanvasEdit(scene, opsC), opsC);
    expect(conflicts(a, b)).toBe(false);
    expect(conflicts(a, c)).toBe(true);
    expect(dependencyState(scene, a)).not.toBe(
      dependencyState(prepareCanvasEdit(scene, opsC), a)
    );
  });

  it('tracks same targets, group descendants and sibling order dependencies', () => {
    const scene = prepareCanvasEdit(createScene(), [
      box('a', 0),
      box('b', 300),
      { kind: 'group', id: 'g', ids: ['a', 'b'] },
    ]);
    const move: CanvasOp[] = [{ kind: 'move', ids: ['g'], dx: 20, dy: 0 }];
    const text: CanvasOp[] = [{ kind: 'text', id: 'a', text: 'Human' }];
    const a = dependencies(scene, prepareCanvasEdit(scene, move), move);
    const b = dependencies(scene, prepareCanvasEdit(scene, text), text);
    expect(conflicts(a, b)).toBe(true);
    expect(dependencyState(scene, a)).not.toBe(
      dependencyState(prepareCanvasEdit(scene, text), a)
    );
  });

  it('invalidates structural ordering when a human adds a distant sibling', () => {
    const scene = prepareCanvasEdit(createScene(), [
      box('a', 0),
      box('b', 300),
    ]);
    const ops: CanvasOp[] = [{ kind: 'order', ids: ['a'], position: 'front' }];
    const deps = dependencies(scene, prepareCanvasEdit(scene, ops), ops);
    const concurrent = prepareCanvasEdit(scene, [box('human', 3000)]);
    expect(dependencyState(scene, deps)).not.toBe(
      dependencyState(concurrent, deps)
    );
  });

  it('runs independent work concurrently and waits for a conflicting predecessor', async () => {
    const scheduler = new CanvasScheduler();
    const scene = createScene();
    const ops = [box('a', 0)];
    const deps = dependencies(scene, prepareCanvasEdit(scene, ops), ops);
    const otherOps = [box('b', 300)];
    const other = dependencies(
      scene,
      prepareCanvasEdit(scene, otherOps),
      otherOps
    );
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const order: string[] = [];
    const first = scheduler.run(deps, async () => {
      order.push('first');
      started.resolve();
      await release.promise;
      order.push('first-done');
    });
    await started.promise;
    const second = scheduler.run(deps, async () => {
      order.push('second');
    });
    await scheduler.run(other, async () => {
      order.push('independent');
    });
    expect(order).toEqual(['first', 'independent']);
    release.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'independent', 'first-done', 'second']);
  });
});
