import { describe, expect, it } from 'vitest';
import { createMountQueue } from './mount-queue';

/** A slice scheduler the test advances by hand, one task at a time. */
function manualSlices() {
  const tasks: (() => void)[] = [];
  return {
    slice: (run: () => void) => {
      tasks.push(run);
      return () => {
        const index = tasks.indexOf(run);
        if (index >= 0) tasks.splice(index, 1);
      };
    },
    step: () => tasks.shift()?.(),
    get pending() {
      return tasks.length;
    },
  };
}

describe('createMountQueue', () => {
  it('runs one mount per task, in order', () => {
    const slices = manualSlices();
    const queue = createMountQueue(slices.slice);
    const mounted: string[] = [];
    queue.enqueue(() => mounted.push('a'));
    queue.enqueue(() => mounted.push('b'));

    expect(mounted).toEqual([]);
    slices.step();
    expect(mounted).toEqual(['a']);
    slices.step();
    expect(mounted).toEqual(['a', 'b']);
    expect(slices.pending).toBe(0);
  });

  it('skips a mount cancelled before its turn', () => {
    const slices = manualSlices();
    const queue = createMountQueue(slices.slice);
    const mounted: string[] = [];
    const cancel = queue.enqueue(() => mounted.push('a'));
    queue.enqueue(() => mounted.push('b'));
    cancel();

    slices.step();
    expect(mounted).toEqual(['b']);
  });

  it('drops everything on dispose', () => {
    const slices = manualSlices();
    const queue = createMountQueue(slices.slice);
    const mounted: string[] = [];
    queue.enqueue(() => mounted.push('a'));
    queue.dispose();

    expect(slices.pending).toBe(0);
    expect(mounted).toEqual([]);
  });
});
