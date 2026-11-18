import type { View } from '@service-storage/generated/schemas/view';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmQueryDependencies } from './dependencies';
import { useCrmLists } from './lists';
import { usePersonalCrmViews } from './saved-views';

let client: QueryClient | undefined;

afterEach(() => {
  cleanup();
  client?.clear();
  client = undefined;
});

const VIEWS: View[] = [
  {
    id: 'list',
    name: 'Targets',
    config: { kind: 'crm-list', teamId: 'team', companyIds: ['company'] },
  },
  {
    id: 'view',
    name: 'Mine',
    config: { kind: 'crm' },
  },
] as unknown as View[];

it('serves CRM lists and personal views from one saved-views read', async () => {
  const getSavedViews = vi.fn(async () => ok({ views: VIEWS }));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const deps = {
    client,
    storage: { views: { getSavedViews } },
    feedback: { success: vi.fn(), failure: vi.fn() },
  } as unknown as CrmQueryDependencies;
  let lists: ReturnType<typeof useCrmLists> | undefined;
  let personal: ReturnType<typeof usePersonalCrmViews> | undefined;
  render(() => {
    lists = useCrmLists(deps, () => 'team');
    personal = usePersonalCrmViews(deps);
    return null;
  });
  await waitFor(() =>
    expect(lists?.lists().map((list) => list.id)).toEqual(['list'])
  );
  expect(personal?.views().map((view) => view.id)).toEqual(['view']);
  expect(getSavedViews).toHaveBeenCalledTimes(1);
});

const RENAMED: View[] = VIEWS.map((view) => ({
  ...view,
  name: `${view.name} again`,
}));

type Readers = {
  lists: ReturnType<typeof useCrmLists>;
  personal: ReturnType<typeof usePersonalCrmViews>;
};

it.each<[string, (readers: Readers) => Promise<unknown>]>([
  [
    'saving a list',
    (r) => r.lists.save.mutateAsync({ name: 'New', companyIds: [] }),
  ],
  [
    'renaming a list',
    (r) =>
      r.lists.save.mutateAsync({ id: 'list', name: 'Targets', companyIds: [] }),
  ],
  ['removing a list', (r) => r.lists.remove.mutateAsync('list')],
  [
    "changing a list's companies",
    (r) =>
      r.lists.setMembership.mutateAsync({
        listId: 'list',
        companyId: 'other',
        included: true,
      }),
  ],
  [
    'saving a view',
    (r) =>
      r.personal.create.mutateAsync({
        name: 'New',
        config: { kind: 'crm' } as never,
      }),
  ],
  [
    'renaming a view',
    (r) => r.personal.rename.mutateAsync({ id: 'view', name: 'Ours' }),
  ],
  ['removing a view', (r) => r.personal.remove.mutateAsync({ id: 'view' })],
  [
    'choosing the default view',
    (r) => r.personal.setDefault.mutateAsync({ id: 'view' }),
  ],
])('refreshes lists and personal views after %s', async (_name, mutate) => {
  let served = VIEWS;
  const write = vi.fn(async () => {
    served = RENAMED;
    return ok({ id: 'new' });
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const deps = {
    client,
    storage: {
      views: {
        getSavedViews: vi.fn(async () => ok({ views: served })),
        createSavedView: write,
        patchView: write,
        deleteView: write,
      },
    },
    feedback: { success: vi.fn(), failure: vi.fn() },
  } as unknown as CrmQueryDependencies;
  let readers: Readers | undefined;
  render(() => {
    readers = {
      lists: useCrmLists(deps, () => 'team'),
      personal: usePersonalCrmViews(deps),
    };
    return null;
  });
  await waitFor(() => expect(readers?.lists.lists()).toHaveLength(1));

  await mutate(readers!);

  await waitFor(() => {
    expect(readers?.lists.lists().map((list) => list.name)).toEqual([
      'Targets again',
    ]);
    expect(readers?.personal.views().map((view) => view.name)).toEqual([
      'Mine again',
    ]);
  });
});
