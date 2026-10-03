import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  enabled: false,
  load: vi.fn(),
  blockImports: 0,
}));
vi.mock('./queries/database-rollout', () => ({
  waitForDatabaseRollout: async () => state.enabled,
}));
vi.mock('@core/block', () => ({
  defineBlock: (value: unknown) => value,
  LoadErrors: { UNAUTHORIZED: 'unauthorized', MISSING: 'missing' },
  loadResult: (value: unknown) => value,
}));
vi.mock('./queries/load-database', () => ({ loadDatabase: state.load }));
vi.mock('@core/component/AccessErrorViews/NotFound', () => ({
  default: function NotFound() {
    return 'not found';
  },
}));
vi.mock('./component/Block', () => {
  state.blockImports++;
  return {
    default: function DatabaseBlock() {
      return 'database block';
    },
  };
});

async function freshDefinition() {
  vi.resetModules();
  return (await import('./definition')).definition;
}

describe('database rollout boundary', () => {
  beforeEach(() => {
    state.enabled = false;
    state.blockImports = 0;
    state.load.mockReset();
  });

  it('answers direct links and preloads as missing without a database request when disabled', async () => {
    const definition = await freshDefinition();
    expect(
      await definition.load({ type: 'dss', id: 'database' }, 'preload')
    ).toBe('missing');
    expect(state.load).not.toHaveBeenCalled();
  });

  it('preloads the not-found view instead of the block bundle when disabled', async () => {
    const definition = await freshDefinition();
    const component = (await definition.component.preload?.()) as {
      default: { name: string };
    };
    expect(component.default.name).toBe('NotFound');
    expect(state.blockImports).toBe(0);
  });

  it('loads the authorized route and the block bundle when enabled', async () => {
    state.enabled = true;
    state.load.mockResolvedValue('loaded');
    const definition = await freshDefinition();
    expect(
      await definition.load({ type: 'dss', id: 'database' }, 'preload')
    ).toBe('loaded');
    expect(state.load).toHaveBeenCalledWith('database');
    const component = (await definition.component.preload?.()) as {
      default: { name: string };
    };
    expect(component.default.name).toBe('DatabaseBlock');
    expect(state.blockImports).toBe(1);
  });
});
