import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreferredInmemModel } from './preferred-inmem-model';

beforeEach(() => window.localStorage.clear());

describe('preferred in-memory model', () => {
  it('remembers the last Models choice across composer mounts', () => {
    createRoot((dispose) => {
      const preferred = createPreferredInmemModel('user-a');
      preferred.remember('fireworks/kimi-k3');
      preferred.remember('fireworks/muse-glimmer-30b');
      expect(preferred.model()).toBe('fireworks/muse-glimmer-30b');
      dispose();
    });
    createRoot((dispose) => {
      expect(createPreferredInmemModel('user-a').model()).toBe(
        'fireworks/muse-glimmer-30b'
      );
      expect(createPreferredInmemModel('user-b').model()).toBeUndefined();
      dispose();
    });
  });

  it('ignores blank stored values', () => {
    window.localStorage.setItem('agents-view-inmem-model-v1:user-a', '  ');
    createRoot((dispose) => {
      expect(createPreferredInmemModel('user-a').model()).toBeUndefined();
      dispose();
    });
  });

  it('keeps working when storage cannot be written', () => {
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Storage unavailable');
      });
    createRoot((dispose) => {
      const preferred = createPreferredInmemModel('user-a');
      preferred.remember('fireworks/kimi-k3');
      expect(preferred.model()).toBe('fireworks/kimi-k3');
      dispose();
    });
    write.mockRestore();
  });
});
