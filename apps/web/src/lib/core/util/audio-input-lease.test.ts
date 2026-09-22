import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireAudioInputLease } from './audio-input-lease';

afterEach(() => vi.unstubAllGlobals());

describe('shared microphone ownership', () => {
  it('keeps a Web Lock until the owning media session releases it', async () => {
    let held = false;
    const request = vi.fn(
      async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<void>
      ) => {
        if (held) return callback(null);
        held = true;
        try {
          await callback({ name: 'macro-audio-input' });
        } finally {
          held = false;
        }
      }
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const release = await acquireAudioInputLease({ required: true });
    expect(held).toBe(true);
    await expect(acquireAudioInputLease({ required: false })).rejects.toThrow(
      'Microphone is already in use'
    );
    release();
    await vi.waitFor(() => expect(held).toBe(false));
    const releaseNext = await acquireAudioInputLease({ required: true });
    expect(request.mock.calls.map(([name]) => name)).toEqual(
      Array(3).fill('macro-audio-input')
    );
    releaseNext();
  });
  it('requires locking for voice and preserves calls in browsers without it', async () => {
    vi.stubGlobal('navigator', {});
    await expect(acquireAudioInputLease({ required: true })).rejects.toThrow(
      'session locking'
    );
    expect(await acquireAudioInputLease({ required: false })).toBeTypeOf(
      'function'
    );
  });
});
