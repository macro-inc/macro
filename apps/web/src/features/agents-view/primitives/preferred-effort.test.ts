import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPreferredEffort } from './preferred-effort';

beforeEach(() => window.localStorage.clear());

const ULTRA = { configId: 'effort', value: 'ultra', name: 'Ultra' };
const HIGH = { configId: 'effort', value: 'high', name: 'High' };

describe('preferred effort', () => {
  it('remembers the last effort per target across composer mounts', () => {
    createRoot((dispose) => {
      const preferred = createPreferredEffort('user-a');
      preferred.remember('cursor:gpt-5', ULTRA);
      preferred.remember('in-memory:kimi', HIGH);
      dispose();
    });
    createRoot((dispose) => {
      const preferred = createPreferredEffort('user-a');
      expect(preferred.effort('cursor:gpt-5')).toEqual(ULTRA);
      expect(preferred.effort('in-memory:kimi')).toEqual(HIGH);
      expect(
        createPreferredEffort('user-b').effort('cursor:gpt-5')
      ).toBeUndefined();
      dispose();
    });
  });

  it('ignores malformed stored values', () => {
    window.localStorage.setItem('agents-view-effort-v1:user-a', '{"x":1');
    window.localStorage.setItem('agents-view-effort-v1:user-b', '{"x":1}');
    createRoot((dispose) => {
      expect(createPreferredEffort('user-a').effort('x')).toBeUndefined();
      expect(createPreferredEffort('user-b').effort('x')).toBeUndefined();
      dispose();
    });
  });
});
