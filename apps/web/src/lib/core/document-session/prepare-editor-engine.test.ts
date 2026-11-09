import { NOOP_SPAN } from '@macro-inc/observability';
import { afterEach, expect, test, vi } from 'vitest';
import { prepareEditorEngine } from './prepare-editor-engine';

afterEach(() => vi.unstubAllGlobals());

test('holds preparation until a paint opportunity and the shared idle task', async () => {
  const frames: FrameRequestCallback[] = [];
  const idle: IdleRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    idle.push(callback);
    return idle.length;
  });
  const prepareMacroPaste = vi.fn();
  const done = prepareEditorEngine({ prepareMacroPaste }, NOOP_SPAN);
  expect(prepareMacroPaste).not.toHaveBeenCalled();
  frames.shift()?.(0);
  await Promise.resolve();
  expect(idle).toHaveLength(0);
  expect(prepareMacroPaste).not.toHaveBeenCalled();
  frames.shift()?.(16);
  await Promise.resolve();
  await Promise.resolve();
  expect(idle).toHaveLength(1);
  expect(prepareMacroPaste).not.toHaveBeenCalled();
  idle[0]({ didTimeout: false, timeRemaining: () => 10 });
  await done;
  expect(prepareMacroPaste).toHaveBeenCalledTimes(1);
});

test('uses a task after paint when idle callbacks are unavailable', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  vi.stubGlobal('requestIdleCallback', undefined);
  const prepareMacroPaste = vi.fn(() => {
    throw new Error('preparation failed');
  });
  await expect(
    prepareEditorEngine({ prepareMacroPaste }, NOOP_SPAN)
  ).rejects.toThrow('preparation failed');
  expect(prepareMacroPaste).toHaveBeenCalledTimes(1);
});
