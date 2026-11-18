import { cleanup, render } from '@solidjs/testing-library';
import deepEqual from 'fast-deep-equal';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { SavedView } from '../core/saved-view';
import type { SavedViewCreation } from '../primitives/create-saved-view-creation';
import { createSavedViewCreation } from '../primitives/create-saved-view-creation';
import { SavedViewDraftHost } from './saved-view-draft-host';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), update: vi.fn() }));
vi.mock('../queries/saved-view-actions', () => ({
  useCreateSavedView: () => ({ mutateAsync: mocks.mutate }),
  useUpdateSavedView: () => ({ mutateAsync: mocks.update }),
  savedViewErrorMessage: () => 'Offline',
}));
vi.mock('../queries/saved-views', () => ({
  toSavedView: (record: unknown) => record,
}));
vi.mock('./saved-view-leave-guard', () => ({
  SavedViewLeaveGuard: () => null,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('persists only wire fields and retains the local draft after a rejected save', async () => {
  let creation: SavedViewCreation | undefined;
  render(() => {
    creation = createSavedViewCreation({
      kind: 'projects',
      viewerId: () => 'viewer',
      list: () => [],
      capture: () => ({ filter: 'open' }),
      equal: deepEqual,
    });
    return (
      <SavedViewDraftHost
        creation={creation}
        refresh={async () => {}}
        discard={creation.discard}
        selection={{ projects: ['savedView'] }}
      />
    );
  });
  if (!creation) throw new Error('Missing creation');
  const draft = creation.begin({ filter: 'open' }, 'New view', true);
  mocks.mutate.mockResolvedValueOnce({ error: { message: 'Offline' } });
  await expect(creation.save()).rejects.toThrow('Offline');
  expect(creation.current()?.id).toBe(draft.id);
  expect(mocks.mutate).toHaveBeenCalledWith({
    id: draft.id,
    name: 'New view',
    config: { filter: 'open' },
    sharedTeamId: null,
  });
  mocks.mutate.mockResolvedValueOnce({
    data: {
      createSavedView: {
        id: draft.id,
        name: 'New view',
        ownerId: 'viewer',
        sharedTeamId: null,
        revision: 1,
        config: { filter: 'open' },
      },
    },
  });
  await creation.save();
  expect(creation.current()).toBeUndefined();
});

it.each(['config', 'name', 'sharing'] as const)(
  'retains newer %s during creation and retries the confirmed revision',
  async (field) => {
    const pending = Promise.withResolvers<{
      data: { createSavedView: SavedView };
    }>();
    mocks.mutate.mockReturnValueOnce(pending.promise);
    let creation: SavedViewCreation | undefined;
    const [config, setConfig] = createSignal({ filter: 'first' });
    render(() => {
      creation = createSavedViewCreation({
        kind: 'tasks',
        viewerId: () => 'viewer',
        list: () => [],
        capture: config,
        equal: deepEqual,
      });
      return (
        <SavedViewDraftHost
          creation={creation}
          refresh={async () => {}}
          discard={creation.discard}
          selection={{ tasks: ['savedView'] }}
        />
      );
    });
    if (!creation) throw new Error('Missing creation');
    const draft = creation.begin(config(), 'New view', true);
    const saving = creation.save();
    let name = 'New view';
    let sharedTeamId: string | null = null;
    if (field === 'config') setConfig({ filter: 'newer' });
    if (field === 'name') {
      name = 'Changed name';
      creation.update({ name });
    }
    if (field === 'sharing') {
      sharedTeamId = 'team';
      creation.update({ sharedTeamId });
    }
    const first = {
      id: draft.id,
      name: 'New view',
      ownerId: 'viewer',
      revision: 1,
      sharedTeamId: null,
      config: { filter: 'first' },
    };
    pending.resolve({ data: { createSavedView: first } });
    await saving;
    expect(creation.current()?.id).toBe(draft.id);
    expect(creation.dirty()).toBe(true);
    expect(creation.persisted()?.revision).toBe(1);
    expect(creation.entries().map((entry) => entry.kind)).toEqual(['draft']);
    mocks.update.mockResolvedValueOnce({
      data: {
        updateSavedView: {
          ...first,
          revision: 2,
          config: config(),
          name,
          sharedTeamId,
        },
      },
    });
    await creation.save();
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({
      id: draft.id,
      name,
      sharedTeamId,
      config: config(),
      expectedRevision: 1,
    });
    expect(creation.current()).toBeUndefined();
  }
);
