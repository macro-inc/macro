import type { EntityData } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useBlockCommandEntity } from './use-block-command-entity';

const state = vi.hoisted(() => ({
  authenticated: true,
  success: false,
  data: [] as EntityData[],
  enabled: (): boolean => false,
}));
vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => () => state.authenticated,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupItemsQuery: (_args: unknown, options: () => { enabled: boolean }) => {
    state.enabled = () => options().enabled;
    return {
      get isSuccess() {
        return state.success;
      },
      get data() {
        if (!state.success) throw new Error('Pending data must not be read');
        return state.data;
      },
    };
  },
}));

it('resolves a direct-loaded block independently of search, without suspending conditions', () => {
  const entity: EntityData = {
    id: 'document-1',
    type: 'document',
    name: 'Example',
    ownerId: 'owner',
    fileType: 'pdf',
  };
  state.success = false;
  state.data = [];
  createRoot((dispose) => {
    const [supplied, setSupplied] = createSignal<EntityData>();
    const resolve = useBlockCommandEntity(entity.id, supplied);
    state.authenticated = false;
    expect(state.enabled()).toBe(false);
    state.authenticated = true;
    expect(state.enabled()).toBe(true);
    expect(resolve()).toBeUndefined();
    state.success = true;
    state.data = [{ ...entity, id: 'another-document' }];
    expect(resolve()).toBeUndefined();
    state.data = [entity];
    expect(resolve()).toEqual(entity);
    setSupplied({ ...entity, name: 'Live metadata' });
    expect(state.enabled()).toBe(false);
    expect(resolve()?.name).toBe('Live metadata');
    dispose();
  });
});
