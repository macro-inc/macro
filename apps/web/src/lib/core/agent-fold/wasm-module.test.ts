import { afterEach, expect, it, vi } from 'vitest';

const moduleUrl = new URL('./wasm/agent_fold.js', import.meta.url).href;

afterEach(() => {
  vi.doUnmock(moduleUrl);
  vi.resetModules();
});

it('shares initialization and retries after a failed speculative preload', async () => {
  const initialize = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  vi.doMock(moduleUrl, () => ({ default: initialize }));
  const { loadAgentFoldWasm } = await import('./wasm-module');

  const first = loadAgentFoldWasm();
  expect(loadAgentFoldWasm()).toBe(first);
  await expect(first).rejects.toThrow('offline');

  const retried = loadAgentFoldWasm();
  expect(retried).not.toBe(first);
  expect(loadAgentFoldWasm()).toBe(retried);
  await retried;
  expect(initialize).toHaveBeenCalledTimes(2);
  expect(loadAgentFoldWasm()).toBe(retried);
});
