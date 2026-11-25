import { QueryClient } from '@tanstack/solid-query';
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
    .mockResolvedValueOnce(ok({ revision: 'r' }))
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
  ).toEqual({ ok: true, value: { revision: 'r' } });
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
