import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreferredRepository } from './preferred-repository';

beforeEach(() => localStorage.clear());

describe('default coding repository', () => {
  it('defaults to auto, persists by user, and can return to auto', () => {
    createRoot((dispose) => {
      const preference = createPreferredRepository('one');
      expect(preference.repository()).toBeUndefined();
      preference.select('https://github.com/org/repo');
      dispose();
    });
    createRoot((dispose) => {
      const preference = createPreferredRepository('one');
      expect(preference.repository()).toBe('https://github.com/org/repo');
      expect(createPreferredRepository('two').repository()).toBeUndefined();
      preference.select(undefined);
      dispose();
    });
    createRoot((dispose) => {
      expect(createPreferredRepository('one').repository()).toBeUndefined();
      dispose();
    });
  });

  it('updates an already mounted composer when settings change', () => {
    createRoot((dispose) => {
      const composer = createPreferredRepository('one');
      const settings = createPreferredRepository('one');
      const other = createPreferredRepository('two');
      settings.select('https://github.com/org/repo');
      expect(composer.repository()).toBe('https://github.com/org/repo');
      expect(other.repository()).toBeUndefined();
      settings.select(undefined);
      expect(composer.repository()).toBeUndefined();
      dispose();
    });
  });

  it('receives changes from another browser tab', () => {
    createRoot((dispose) => {
      const preference = createPreferredRepository('one');
      const key = 'agents-default-repository-v1:one';
      localStorage.setItem(key, 'https://github.com/org/repo');
      window.dispatchEvent(new StorageEvent('storage', { key }));
      expect(preference.repository()).toBe('https://github.com/org/repo');
      dispose();
    });
  });

  it('keeps live preferences when storage is unavailable', () => {
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Unavailable');
      });
    createRoot((dispose) => {
      const settings = createPreferredRepository('one');
      const composer = createPreferredRepository('one');
      settings.select('https://github.com/org/repo');
      expect(composer.repository()).toBe('https://github.com/org/repo');
      dispose();
    });
    write.mockRestore();
  });
});
