import { cleanup, render } from '@solidjs/testing-library';
import deepEqual from 'fast-deep-equal';
import { afterEach, expect, it, vi } from 'vitest';
import type { SavedViewCreation } from '../primitives/create-saved-view-creation';
import { createSavedViewCreation } from '../primitives/create-saved-view-creation';
import { SavedViewDraftHost } from './saved-view-draft-host';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../queries/saved-view-actions', () => ({
  useCreateSavedView: () => ({ mutateAsync: mocks.mutate }),
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
