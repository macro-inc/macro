import type { View } from '@service-storage/generated/schemas/view';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmQueryDependencies } from './dependencies';
import { useCrmLists } from './lists';
import { usePersonalCrmViews } from './saved-views';

afterEach(cleanup);

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
  const client = new QueryClient({
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
  client.clear();
});
