import { beforeEach, describe, expect, it, vi } from 'vitest';
import { definition } from './definition';

const state = vi.hoisted(() => ({ enabled: false, load: vi.fn() }));
vi.mock('./queries/database-rollout', () => ({
  waitForDatabaseRollout: async () => state.enabled,
}));
vi.mock('@core/block', () => ({
  defineBlock: (value: unknown) => value,
  LoadErrors: { UNAUTHORIZED: 'disabled', MISSING: 'missing' },
  loadResult: (value: unknown) => value,
}));
vi.mock('./queries/load-database', () => ({ loadDatabase: state.load }));

describe('database rollout boundary', () => {
  beforeEach(() => {
    state.enabled = false;
    state.load.mockReset();
  });
  it('refuses direct links and preloads without making a database request when disabled', async () => {
    expect(
      await definition.load({ type: 'dss', id: 'database' }, 'preload')
    ).toBe('disabled');
    expect(state.load).not.toHaveBeenCalled();
  });
  it('loads the authorized route when enabled', async () => {
    state.enabled = true;
    state.load.mockResolvedValue('loaded');
    expect(
      await definition.load({ type: 'dss', id: 'database' }, 'preload')
    ).toBe('loaded');
    expect(state.load).toHaveBeenCalledWith('database');
  });
});
