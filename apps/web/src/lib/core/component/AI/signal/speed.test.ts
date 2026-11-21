import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

it('carries the old fast-mode switch over as the fastest tier', async () => {
  localStorage.setItem('macro:ai-fast-mode', 'true');
  const { preferredSpeed, setPreferredSpeed } = await import('./speed');
  expect(preferredSpeed()).toBe('ultrafast');
  setPreferredSpeed('priority');
  expect(localStorage.getItem('macro:ai-speed')).toBe('priority');
  expect(localStorage.getItem('macro:ai-fast-mode')).toBeNull();
});

it('ignores an unknown stored tier', async () => {
  localStorage.setItem('macro:ai-speed', 'warp');
  const { preferredSpeed } = await import('./speed');
  expect(preferredSpeed()).toBe('standard');
});
