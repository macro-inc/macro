import { ThrownResultError } from '@core/util/result';
import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import type { MergeRecordType } from '../core/merge';
import { crmKeys } from './keys';
import { createMergeCommands } from './merges';

const effects = vi.hoisted(() => ({
  commit: vi.fn(),
  forget: vi.fn(async () => {}),
  contacts: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
}));
vi.mock('@service-storage/graphql-crm-edits', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@service-storage/graphql-crm-edits')
  >()),
  commitGraphqlCrmMerge: effects.commit,
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
  effects.commit.mockReset();
  client = new QueryClient();
});

function commandsWith(
  storage: Record<string, unknown>,
  recordType: MergeRecordType = 'company'
) {
  return createMergeCommands(
    {
      client,
      storage: storage as never,
      hasLiveCache: () => false,
    },
    recordType
  );
}

function committed(
  survivorId: string,
  mergedIds: string[],
  effectsResolved = false
) {
  return {
    payload: { survivorId, mergedIds, mergeId: 'm' },
    effectsResolved,
    cacheRevalidates: false,
    listsReadAgain: false,
  };
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

it('reviews a merge of people, reading people under other companies and a kind it doesn’t know', async () => {
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
          blocked: { kind: 'something_new', items: [1] },
        },
      ])
    );
  const commands = commandsWith({ previewCrmMerge }, 'contact');

  expect(
    await commands.review({ survivorId: 'pat', sourceIds: ['pat-l'] })
  ).toEqual({
    ok: true,
    value: {
      revision: 'r',
      conflicts: [],
      blocked: { kind: 'different_companies', people },
    },
  });
  expect(previewCrmMerge).toHaveBeenCalledWith({
    recordType: 'contact',
    survivorId: 'pat',
    sourceIds: ['pat-l'],
  });
  expect(
    await commands.review({ survivorId: 'pat', sourceIds: ['pat-l'] })
  ).toEqual({
    ok: false,
    refusal: {
      code: 'merge_conflict',
      blocked: { kind: 'unknown' },
      currentId: null,
    },
  });
});

it('after a merge of people, forgets them and drops their unopened reads', async () => {
  const merged = crmKeys.contact('pat-l').queryKey;
  const kept = crmKeys.contact('pat').queryKey;
  client.setQueryData(merged, { id: 'pat-l', name: 'Pat L.' });
  client.setQueryData(kept, { id: 'pat', name: 'Pat Lee' });
  effects.commit.mockResolvedValue(committed('pat', ['PAT-L']));
  const commands = commandsWith({}, 'contact');

  await commands.commit({
    survivorId: 'pat',
    sourceIds: ['PAT-L'],
    revision: 'r',
    requestKey: 'key',
    sharingRules: 'keep',
  });

  expect(effects.commit).toHaveBeenCalledWith(
    expect.objectContaining({ recordType: 'CONTACT', survivorId: 'pat' }),
    expect.anything()
  );
  expect(effects.forget).toHaveBeenCalledWith({
    companies: [],
    contacts: ['pat-l'],
  });
  expect(client.getQueryState(merged)).toBeUndefined();
  expect(client.getQueryData(kept)).toEqual({ id: 'pat', name: 'Pat Lee' });
  expect(effects.refresh).toHaveBeenCalled();
});

it('uses committed tombstones and skips an already revalidated list', async () => {
  effects.commit.mockResolvedValue({
    ...committed('kept', ['OLD-1'], true),
    listsReadAgain: true,
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const commands = commandsWith({});

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
  expect(effects.commit).toHaveBeenCalledWith(
    {
      recordType: 'COMPANY',
      survivorId: 'kept',
      sourceIds: ['OLD-1'],
      revision: 'r',
      requestKey: 'key',
      sharingRules: 'STOP',
    },
    expect.anything()
  );
  expect(effects.forget).not.toHaveBeenCalled();
  expect(effects.contacts).toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: crmKeys._def });
  expect(effects.refresh).not.toHaveBeenCalled();
});

it('changes nothing locally when a commit is refused', async () => {
  effects.commit.mockRejectedValue(
    new ThrownResultError([{ code: 'merge_preview_stale', message: 'stale' }])
  );
  const commands = commandsWith({});

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
  effects.commit.mockResolvedValue(committed('kept', ['old-1', 'old-2'], true));
  const commands = commandsWith({});

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
  effects.commit.mockRejectedValue(new Error('unavailable'));
  const commands = commandsWith({});

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
