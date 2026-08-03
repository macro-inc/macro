import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserScopedStorage } from './userScopedStorage';

describe('createUserScopedStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips a value for a user', () => {
    const storage = createUserScopedStorage('macro:test');
    storage.write('user-1', 'value');
    expect(storage.read('user-1')).toBe('value');
  });

  it('returns null when nothing is stored', () => {
    const storage = createUserScopedStorage('macro:test');
    expect(storage.read('user-1')).toBeNull();
  });

  it('scopes values per user', () => {
    const storage = createUserScopedStorage('macro:test');
    storage.write('user-1', 'one');
    storage.write('user-2', 'two');
    expect(storage.read('user-1')).toBe('one');
    expect(storage.read('user-2')).toBe('two');
  });

  it('encodes user ids so delimiter characters cannot collide', () => {
    const storage = createUserScopedStorage('macro:test');
    storage.write('a:b', 'colon');
    storage.write('a%3Ab', 'encoded');
    expect(storage.read('a:b')).toBe('colon');
  });

  it('reads null when storage access throws', () => {
    const storage = createUserScopedStorage('macro:test');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(storage.read('user-1')).toBeNull();
  });

  it('swallows write failures', () => {
    const storage = createUserScopedStorage('macro:test');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => storage.write('user-1', 'value')).not.toThrow();
  });

  it('degrades to no value when localStorage is unavailable', () => {
    const storage = createUserScopedStorage('macro:test');
    vi.stubGlobal('localStorage', undefined);
    expect(storage.read('user-1')).toBeNull();
    expect(() => storage.write('user-1', 'value')).not.toThrow();
  });
});
