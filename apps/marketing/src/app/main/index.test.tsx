import { waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../utils/utilHeroEntrance', () => ({
  preserveHeroEntrance: () => () => {},
}));

afterEach(() => {
  document.body.textContent = '';
  vi.doUnmock('./App');
  vi.resetModules();
});

it('keeps the prerendered page until the cold product route is ready', async () => {
  const root = document.createElement('div');
  root.id = 'root';
  root.innerHTML = '<h1>Existing product page</h1>';
  document.body.append(root);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const preload = vi.fn(() => pending);
  vi.doMock('./App', () => ({
    preloadProductRoute: preload,
    App: () => <h1>Ready product page</h1>,
  }));
  const boot = import('./index');
  await waitFor(() => expect(preload).toHaveBeenCalled());
  expect(root.textContent).toBe('Existing product page');
  finish();
  await boot;
  expect(root.textContent).toBe('Ready product page');
});
