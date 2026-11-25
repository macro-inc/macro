import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { crmKeys } from './keys';
import { createMergeCommands } from './merges';

const effects = vi.hoisted(() => ({
  forget: vi.fn(async () => {}),
  contacts: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
}));
vi.mock('@service-storage/crm-record-merge', () => ({
  forgetMergedCrmRecords: effects.forget,
}));
vi.mock('@service-storage/crm-contacts', () => ({
  invalidateCachedCrmContacts: effects.contacts,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: effects.refresh,
}));

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
});

function commandsWith(storage: Record<string, unknown>) {
  return createMergeCommands({
    client,
    storage: storage as never,
  });
}

it('reviews a company merge and reads a refusal by its code', async () => {
  const previewCrmMerge = vi
    .fn()
    .mockResolvedValueOnce(ok({ revision: 'r', conflicts: [], blocked: null }))
    .mockResolvedValueOnce(
      err([
        {
          code: 'merge_conflict',
          message: 'no',
          blocked: { kind: 'same_address_people', people: [] },
        },
      ])
    );
  const commands = commandsWith({ previewCrmMerge });

  expect(
    await commands.review({ survivorId: 'kept', sourceIds: ['old'] })
  ).toEqual({
    ok: true,
    value: { revision: 'r', conflicts: [], blocked: null },
  });
  expect(previewCrmMerge).toHaveBeenCalledWith({
    recordType: 'company',
    survivorId: 'kept',
    sourceIds: ['old'],
  });
  expect(
    await commands.review({ survivorId: 'kept', sourceIds: ['old'] })
  ).toEqual({
    ok: false,
    refusal: {
      code: 'merge_conflict',
      blocked: { kind: 'same_address_people', people: [] },
      currentId: null,
    },
  });
});

it('reads a block it shows no people for by its kind alone', async () => {
  const people = [
    {
      contactId: 'c1',
      name: 'Pat',
      companyId: 'other',
      companyName: 'Other Co',
    },
  ];
  const previewCrmMerge = vi
    .fn()
    .mockResolvedValueOnce(
      ok({
        revision: 'r',
        conflicts: [],
        blocked: { kind: 'different_companies', people },
      })
    )
    .mockResolvedValueOnce(
      err([
        {
          code: 'merge_conflict',
          message: 'no',
          blocked: { kind: 'different_companies', people },
        },
      ])
    );
  const commands = commandsWith({ previewCrmMerge });

  expect(
    await commands.review({ survivorId: 'kept', sourceIds: ['old'] })
  ).toEqual({
    ok: true,
    value: {
      revision: 'r',
      conflicts: [],
      blocked: { kind: 'different_companies' },
    },
  });
  expect(
    await commands.review({ survivorId: 'kept', sourceIds: ['old'] })
  ).toEqual({
    ok: false,
    refusal: {
      code: 'merge_conflict',
      blocked: { kind: 'different_companies' },
      currentId: null,
    },
  });
});

it('after a commit, forgets the merged companies and reads everything again', async () => {
  const commitCrmMerge = vi.fn(async () =>
    ok({ survivorId: 'kept', mergedIds: ['OLD-1'], mergeId: 'm' })
  );
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const commands = commandsWith({ commitCrmMerge });

  const answer = await commands.commit({
    survivorId: 'kept',
    sourceIds: ['OLD-1'],
    revision: 'r',
    requestKey: 'key',
    sharingRules: 'stop',
  });

  expect(answer).toEqual({
    ok: true,
    value: { survivorId: 'kept', mergedIds: ['OLD-1'] },
  });
  expect(commitCrmMerge).toHaveBeenCalledWith({
    recordType: 'company',
    survivorId: 'kept',
    sourceIds: ['OLD-1'],
    revision: 'r',
    requestKey: 'key',
    sharingRules: 'stop',
  });
  expect(effects.forget).toHaveBeenCalledWith({
    companies: ['old-1'],
    contacts: [],
  });
  expect(effects.contacts).toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: crmKeys._def });
  expect(effects.refresh).toHaveBeenCalled();
});

it('changes nothing locally when a commit is refused', async () => {
  const commands = commandsWith({
    commitCrmMerge: vi.fn(async () =>
      err([{ code: 'merge_preview_stale', message: 'stale' }])
    ),
  });

  const answer = await commands.commit({
    survivorId: 'kept',
    sourceIds: ['old'],
    revision: 'r',
    requestKey: 'key',
    sharingRules: 'keep',
  });

  expect(answer).toMatchObject({
    ok: false,
    refusal: { code: 'merge_preview_stale' },
  });
  expect(effects.forget).not.toHaveBeenCalled();
  expect(effects.refresh).not.toHaveBeenCalled();
});

it('drops the merged company’s unopened reads, so its next open fetches and moves', async () => {
  const merged = crmKeys.company('old-1').queryKey;
  const mergedPeople = crmKeys.companyContacts('old-1').queryKey;
  const kept = crmKeys.company('kept').queryKey;
  client.setQueryData(merged, { id: 'old-1', name: 'Old Co' });
  client.setQueryData(mergedPeople, { contacts: [] });
  client.setQueryData(kept, { id: 'kept', name: 'Kept Co' });
  const open = crmKeys.company('old-2').queryKey;
  const fetchOpen = vi.fn(async () => ({ id: 'kept', name: 'Kept Co' }));
  const observer = new QueryObserver(client, {
    queryKey: open,
    queryFn: fetchOpen,
    staleTime: 60_000,
  });
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(fetchOpen).toHaveBeenCalledTimes(1));
  const commands = commandsWith({
    commitCrmMerge: vi.fn(async () =>
      ok({ survivorId: 'kept', mergedIds: ['old-1', 'old-2'], mergeId: 'm' })
    ),
  });

  await commands.commit({
    survivorId: 'kept',
    sourceIds: ['old-1', 'old-2'],
    revision: 'r',
    requestKey: 'key',
    sharingRules: 'keep',
  });

  expect(client.getQueryState(merged)).toBeUndefined();
  expect(client.getQueryState(mergedPeople)).toBeUndefined();
  expect(client.getQueryData(kept)).toEqual({ id: 'kept', name: 'Kept Co' });
  expect(fetchOpen).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it('reads a commit with no merge code as unconfirmed, since it may have gone through', async () => {
  const commands = commandsWith({
    commitCrmMerge: vi.fn(async () =>
      err([{ code: 'HTTP_ERROR', message: 'HTTP error! status: 502' }])
    ),
  });

  const answer = await commands.commit({
    survivorId: 'kept',
    sourceIds: ['old'],
    revision: 'r',
    requestKey: 'key',
    sharingRules: 'keep',
  });

  expect(answer).toMatchObject({
    ok: false,
    refusal: { code: 'merge_unconfirmed' },
  });
});
