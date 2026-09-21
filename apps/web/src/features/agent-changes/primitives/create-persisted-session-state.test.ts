import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createPersistedSessionState } from './create-persisted-session-state';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('createPersistedSessionState', () => {
  it('writes under the session key and reloads per session', () => {
    createRoot((dispose) => {
      const storage = memoryStorage();
      const [sessionId, setSessionId] = createSignal<string | undefined>('s1');
      const [count, setCount] = createPersistedSessionState<number>({
        sessionId,
        namespace: 'test',
        initial: () => 0,
        parse: (raw) => (typeof raw === 'number' ? raw : undefined),
        storage,
      });
      expect(count()).toBe(0);
      setCount((n) => n + 2);
      expect(count()).toBe(2);
      expect(storage.map.get('test:s1')).toBe('2');

      setSessionId('s2');
      expect(count()).toBe(0);
      setCount(5);
      expect(storage.map.get('test:s2')).toBe('5');

      setSessionId('s1');
      expect(count()).toBe(2);
      dispose();
    });
  });

  it('ignores junk in storage and keeps working without a session', () => {
    createRoot((dispose) => {
      const storage = memoryStorage();
      storage.map.set('test:s1', '{not json');
      const [sessionId] = createSignal<string | undefined>('s1');
      const [value, setValue] = createPersistedSessionState<number>({
        sessionId,
        namespace: 'test',
        initial: () => 1,
        parse: (raw) => (typeof raw === 'number' ? raw : undefined),
        storage,
      });
      expect(value()).toBe(1);

      const [none] = createSignal<string | undefined>(undefined);
      const [memory, setMemory] = createPersistedSessionState<number>({
        sessionId: none,
        namespace: 'test',
        initial: () => 1,
        parse: (raw) => (typeof raw === 'number' ? raw : undefined),
        storage,
      });
      setMemory(9);
      setValue(3);
      expect(memory()).toBe(9);
      expect(storage.map.has('test:undefined')).toBe(false);
      dispose();
    });
  });
});
