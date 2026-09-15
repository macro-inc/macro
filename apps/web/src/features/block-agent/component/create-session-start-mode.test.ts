import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionStartMode } from './create-session-start-mode';
import { SESSION_START_MODE_STORAGE_KEY } from './session-start-mode';

beforeEach(() => window.localStorage.clear());

function storageKey(userId: string) {
  return `${SESSION_START_MODE_STORAGE_KEY}:${encodeURIComponent(userId)}`;
}

describe('session start mode persistence', () => {
  it('defaults to live and persists a user-chosen background mode', () => {
    createRoot((dispose) => {
      const [cmdHeld] = createSignal(false);
      const mode = createSessionStartMode('user-a', cmdHeld);
      expect(mode.committed()).toBe('live');
      expect(mode.effective()).toBe('live');
      mode.setCommitted('background');
      expect(mode.committed()).toBe('background');
      expect(window.localStorage.getItem(storageKey('user-a'))).toBe(
        'background'
      );
      dispose();
    });
    createRoot((dispose) => {
      const [cmdHeld] = createSignal(false);
      expect(createSessionStartMode('user-a', cmdHeld).committed()).toBe(
        'background'
      );
      expect(createSessionStartMode('user-b', cmdHeld).committed()).toBe(
        'live'
      );
      dispose();
    });
  });

  it('previews background while cmd is held and restores live on release', () => {
    createRoot((dispose) => {
      const [cmdHeld, setCmdHeld] = createSignal(false);
      const mode = createSessionStartMode('user-a', cmdHeld);
      setCmdHeld(true);
      expect(mode.effective()).toBe('background');
      expect(mode.committed()).toBe('live');
      expect(window.localStorage.getItem(storageKey('user-a'))).toBeNull();
      setCmdHeld(false);
      expect(mode.effective()).toBe('live');
      dispose();
    });
  });

  it('ignores cmd when the user has already chosen background', () => {
    createRoot((dispose) => {
      const [cmdHeld, setCmdHeld] = createSignal(false);
      const mode = createSessionStartMode('user-a', cmdHeld);
      mode.setCommitted('background');
      setCmdHeld(true);
      expect(mode.effective()).toBe('background');
      setCmdHeld(false);
      expect(mode.effective()).toBe('background');
      dispose();
    });
  });

  it('ignores malformed storage and keeps working when writes fail', () => {
    window.localStorage.setItem(storageKey('user-a'), 'nope');
    createRoot((dispose) => {
      const [cmdHeld] = createSignal(false);
      expect(createSessionStartMode('user-a', cmdHeld).committed()).toBe(
        'live'
      );
      dispose();
    });
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Storage unavailable');
      });
    createRoot((dispose) => {
      const [cmdHeld] = createSignal(false);
      const mode = createSessionStartMode('user-a', cmdHeld);
      mode.setCommitted('background');
      expect(mode.committed()).toBe('background');
      dispose();
    });
    write.mockRestore();
  });
});
