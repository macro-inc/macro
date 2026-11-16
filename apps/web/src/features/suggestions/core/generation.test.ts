import { describe, expect, it } from 'vitest';
import { refreshState } from './generation';

const NOW = new Date('2026-11-13T10:00:00Z');

describe('refreshState', () => {
  it('is running while a generation runs, whatever the cooldown says', () => {
    expect(
      refreshState(
        {
          state: 'running',
          trigger: 'nightly',
          regenerateAvailableAt: '2026-11-13T10:30:00Z',
        },
        NOW
      )
    ).toEqual({ kind: 'running' });
  });

  it('waits until the cooldown ends, then is ready', () => {
    const idle = {
      state: 'idle' as const,
      regenerateAvailableAt: '2026-11-13T10:30:00Z',
    };

    expect(refreshState(idle, NOW)).toEqual({
      kind: 'cooldown',
      availableAt: new Date('2026-11-13T10:30:00Z'),
    });
    expect(refreshState(idle, new Date('2026-11-13T10:30:00Z'))).toEqual({
      kind: 'ready',
    });
    expect(refreshState({ state: 'idle' }, NOW)).toEqual({ kind: 'ready' });
  });
});
