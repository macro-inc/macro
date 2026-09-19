import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  sessionLastError,
  setSessionLastError,
  useSessionLastError,
} from './session-last-error';

describe('session last error', () => {
  it('stores the newest failure per session and forgets a cleared one', () => {
    setSessionLastError('a', 'boom');
    expect(sessionLastError('a')).toBe('boom');
    setSessionLastError('a', undefined);
    expect(sessionLastError('a')).toBeUndefined();
  });

  it('notifies a subscriber when that session changes', () => {
    const dispose = createRoot((dispose) => {
      const error = useSessionLastError(() => 'live');
      expect(error()).toBeUndefined();
      setSessionLastError('live', 'no credentials');
      expect(error()).toBe('no credentials');
      setSessionLastError('other', 'ignored');
      expect(error()).toBe('no credentials');
      return dispose;
    });
    dispose();
    setSessionLastError('live', undefined);
  });
});
