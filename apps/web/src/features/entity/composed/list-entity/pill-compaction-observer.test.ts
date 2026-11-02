import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createPillCompaction } from './pill-compaction';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('removes rows without reconnecting observers on surviving rows', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  const disposers: (() => void)[] = [];
  for (let i = 0; i < 100; i++) {
    createRoot((dispose) => {
      const row = document.createElement('div');
      const pills = document.createElement('span');
      row.append(pills);
      createPillCompaction(
        () => pills,
        () => row
      );
      disposers.push(dispose);
    });
  }
  expect(observe).toHaveBeenCalledTimes(100);
  for (const dispose of disposers) dispose();
  await Promise.resolve();
  expect(observe).toHaveBeenCalledTimes(100);
});
