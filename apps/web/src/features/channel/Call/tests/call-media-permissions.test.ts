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

it('preserves prompt after dismissal and recovers only the current failed capture', async () => {
  const status = Object.assign(new EventTarget(), {
    state: 'prompt' as PermissionState,
  });
  vi.stubGlobal('navigator', { permissions: { query: async () => status } });
  const granted = vi.fn(
    async (device: 'camera' | 'microphone'): Promise<void> => {
      await state.capture(device, async () => {});
    }
  );
  let dispose = () => {};
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    return createCallMediaPermissions({ onGranted: granted });
  });
  await expect(
    state.capture('camera', async () => {
      throw new DOMException('Dismissed', 'NotAllowedError');
    })
  ).rejects.toThrow('Dismissed');
  expect(state.camera()).toBe('prompt');
  status.state = 'granted';
  status.dispatchEvent(new Event('change'));
  expect(granted).toHaveBeenCalledExactlyOnceWith('camera');
  status.dispatchEvent(new Event('change'));
  expect(granted).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(state.camera()).toBe('granted'));
  status.state = 'denied';
  status.dispatchEvent(new Event('change'));
  let current = true;
  await expect(
    state.capture(
      'microphone',
      async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
      () => current
    )
  ).rejects.toThrow('Denied');
  current = false;
  status.state = 'granted';
  status.dispatchEvent(new Event('change'));
  expect(granted).toHaveBeenCalledTimes(1);
  dispose();
});

it('keeps OS denial visible until a granted browser permission captures successfully', async () => {
  const status = Object.assign(new EventTarget(), {
    state: 'denied' as PermissionState,
  });
  vi.stubGlobal('navigator', { permissions: { query: async () => status } });
  const granted = vi.fn(async () => {});
  let dispose = () => {};
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    return createCallMediaPermissions({ onGranted: granted });
  });
  await expect(
    state.capture('camera', async () => {
      throw new DOMException('OS denied', 'NotAllowedError');
    })
  ).rejects.toThrow('OS denied');
  status.state = 'granted';
  status.dispatchEvent(new Event('change'));
  expect(granted).toHaveBeenCalledOnce();
  expect(state.camera()).toBe('denied');
  await state.capture('camera', async () => {});
  expect(state.camera()).toBe('granted');
  dispose();
});

it('deduplicates grant notifications while recovered capture is pending', async () => {
  const status = Object.assign(new EventTarget(), {
    state: 'denied' as PermissionState,
  });
  vi.stubGlobal('navigator', { permissions: { query: async () => status } });
  let finish!: () => void;
  let dispose = () => {};
  const retry = vi.fn(() =>
    state.capture(
      'camera',
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
  );
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    return createCallMediaPermissions({ onGranted: retry });
  });
  await expect(
    state.capture('camera', async () => {
      throw new DOMException('OS denied', 'NotAllowedError');
    })
  ).rejects.toThrow();
  status.state = 'granted';
  status.dispatchEvent(new Event('change'));
  status.dispatchEvent(new Event('change'));
  window.dispatchEvent(new Event('focus'));
  await Promise.resolve();
  expect(retry).toHaveBeenCalledOnce();
  expect(state.camera()).toBe('denied');
  finish();
  await vi.waitFor(() => expect(state.camera()).toBe('granted'));
  dispose();
});
