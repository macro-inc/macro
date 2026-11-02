/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { ErrorBoundary, Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { lazyNamed } from './lazyNamed';

afterEach(cleanup);

it('retains an early import failure until recovery joins, including consumption of its cached rejection', async () => {
  const { registerChunkLoadRecovery } = await import('./chunk-load-errors');
  const failed = new Error('missing module');
  const importer = vi.fn(async (): Promise<{ View: () => null }> => {
    window.dispatchEvent(new Event('vite:preloadError'));
    throw failed;
  });
  const Component = lazyNamed(importer, 'View');
  await expect(Component.preload()).rejects.toBe(failed);
  // Consuming Solid's cached promise does not emit Vite's error event again.
  const recover = vi.fn();
  registerChunkLoadRecovery(recover);
  expect(recover).toHaveBeenCalledOnce();
  render(() => (
    <ErrorBoundary fallback={<p role="alert">Load failed</p>}>
      <Suspense>
        <Component />
      </Suspense>
    </ErrorBoundary>
  ));
  await screen.findByRole('alert');
  expect(importer).toHaveBeenCalledOnce();
  expect(recover).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('vite:preloadError'));
  expect(recover).toHaveBeenCalledTimes(2);
});

it('keeps a successfully preloaded named view synchronously ready on first render', async () => {
  const importer = vi.fn(async () => ({ View: () => <p>Loaded view</p> }));
  const Component = lazyNamed(importer, 'View');
  await Promise.all([Component.preload(), Component.preload()]);
  const fallback = vi.fn(() => <p>Pending view</p>);
  render(() => (
    <Suspense fallback={fallback()}>
      <Component />
    </Suspense>
  ));
  expect(screen.getByText('Loaded view')).toBeTruthy();
  // Suspense evaluates its fallback only when a resource actually suspends.
  expect(fallback).not.toHaveBeenCalled();
  expect(importer).toHaveBeenCalledOnce();
});
