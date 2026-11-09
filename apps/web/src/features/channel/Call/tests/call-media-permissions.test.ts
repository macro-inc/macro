/** @vitest-environment jsdom */
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCallMediaPermissions } from '../call-media-permissions';

afterEach(() => vi.unstubAllGlobals());

it('reads both query states, follows changes, and removes listeners', async () => {
  const mic = Object.assign(new EventTarget(), {
    state: 'granted' as PermissionState,
  });
  const camera = Object.assign(new EventTarget(), {
    state: 'denied' as PermissionState,
  });
  const remove = vi.spyOn(camera, 'removeEventListener');
  vi.stubGlobal('navigator', {
    permissions: {
      query: ({ name }: PermissionDescriptor) =>
        Promise.resolve(name === 'microphone' ? mic : camera),
    },
  });
  let dispose = () => {};
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    return createCallMediaPermissions();
  });
  await vi.waitFor(() => expect(state.microphone()).toBe('granted'));
  expect(state.camera()).toBe('denied');
  camera.state = 'prompt';
  camera.dispatchEvent(new Event('change'));
  expect(state.camera()).toBe('prompt');
  dispose();
  expect(remove).toHaveBeenCalled();
});

it('handles unsupported queries, capture denial, recovery, and unrelated errors', async () => {
  vi.stubGlobal('navigator', {
    permissions: { query: () => Promise.reject(new TypeError('Unsupported')) },
  });
  let dispose = () => {};
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    return createCallMediaPermissions();
  });
  expect(state.microphone()).toBe('prompt');
  await expect(
    state.capture('microphone', () =>
      Promise.reject(new DOMException('Denied', 'NotAllowedError'))
    )
  ).rejects.toThrow('Denied');
  expect(state.microphone()).toBe('denied');
  await state.capture('microphone', () => Promise.resolve());
  expect(state.microphone()).toBe('granted');
  await expect(
    state.capture('camera', () => Promise.reject(new Error('No device')))
  ).rejects.toThrow('No device');
  expect(state.camera()).toBe('prompt');
  dispose();
});

it('ignores stale captures after a newer permission result or disposal', async () => {
  vi.stubGlobal('navigator', {});
  let dispose = () => {};
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    return createCallMediaPermissions();
  });
  let reject = (_error: Error) => {};
  const pending = state.capture(
    'camera',
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  await state.capture('camera', () => Promise.resolve());
  reject(new DOMException('Old denial', 'NotAllowedError'));
  await expect(pending).rejects.toThrow('Old denial');
  expect(state.camera()).toBe('granted');
  await state.capture(
    'microphone',
    () => Promise.resolve(),
    () => false
  );
  expect(state.microphone()).toBe('prompt');
  dispose();
  await state.capture('microphone', () => Promise.resolve());
  expect(state.microphone()).toBe('prompt');
});
