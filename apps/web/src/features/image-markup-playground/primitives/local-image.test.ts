import type { LocalImage } from '@macro-inc/graphics/browser';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createLocalImageState } from './local-image';

function image(name: string): LocalImage {
  return {
    name,
    src: `blob:${name}`,
    width: 100,
    height: 80,
    dispose: vi.fn(),
  };
}

it('keeps the old image on failure and disposes replaced images and the final owner', async () => {
  const first = image('first');
  const second = image('second');
  const loader = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce(new Error('bad'))
    .mockResolvedValueOnce(second);
  const onLoad = vi.fn();
  const owned = createRoot((dispose) => ({
    ...createLocalImageState(onLoad, loader),
    dispose,
  }));
  const file = new File([''], 'test.png');
  await owned.load(file);
  await owned.load(file);
  expect(owned.image()).toBe(first);
  expect(owned.error()).toBeTruthy();
  expect(first.dispose).not.toHaveBeenCalled();
  await owned.load(file);
  expect(first.dispose).toHaveBeenCalledOnce();
  expect(owned.error()).toBeUndefined();
  owned.dispose();
  expect(second.dispose).toHaveBeenCalledOnce();
});

it('disposes stale decodes after a newer image or owner cleanup', async () => {
  const pending: ((image: LocalImage) => void)[] = [];
  const loader = () =>
    new Promise<LocalImage>((resolve) => pending.push(resolve));
  const onLoad = vi.fn();
  const owned = createRoot((dispose) => ({
    ...createLocalImageState(onLoad, loader),
    dispose,
  }));
  const file = new File([''], 'test.png');
  const firstLoad = owned.load(file);
  const secondLoad = owned.load(file);
  const newest = image('newest');
  pending[1](newest);
  await secondLoad;
  const stale = image('stale');
  pending[0](stale);
  await firstLoad;
  expect(owned.image()).toBe(newest);
  expect(stale.dispose).toHaveBeenCalledOnce();
  const finalLoad = owned.load(file);
  owned.dispose();
  const late = image('late');
  pending[2](late);
  await finalLoad;
  expect(late.dispose).toHaveBeenCalledOnce();
  expect(onLoad).toHaveBeenCalledTimes(1);
});
