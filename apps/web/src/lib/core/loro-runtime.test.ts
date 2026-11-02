/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';

const constructDocument = vi.hoisted(() => vi.fn());
vi.mock('loro-crdt', () => ({ LoroDoc: constructDocument }));
vi.mock('loro-crdt/bundler/loro_wasm_bg.wasm?url', () => ({
  default: '/assets/loro-test.wasm',
}));

it('starts one matching WASM hint only on admission, without constructing documents', async () => {
  const { prepareLoro } = await import('./loro-runtime');
  expect(document.head.querySelector('link[rel="preload"]')).toBeNull();
  const first = prepareLoro();
  const hint = document.head.querySelector('link[rel="preload"]');
  if (!(hint instanceof HTMLLinkElement))
    throw new Error('Missing preload link');
  expect(hint.as).toBe('fetch');
  expect(hint.getAttribute('href')).toBe('/assets/loro-test.wasm');
  expect(hint?.getAttribute('crossorigin')).toBe('anonymous');
  expect(hint?.getAttribute('type')).toBe('application/wasm');
  await Promise.all([first, prepareLoro()]);
  expect(document.head.querySelectorAll('link[rel="preload"]')).toHaveLength(1);
  expect(constructDocument).not.toHaveBeenCalled();
});
