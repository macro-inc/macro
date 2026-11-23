import type { ContactSnapshot } from '@graphql-cache/people/generated';
import { createPeopleCache } from '@graphql-cache/people/host';
import { unsupportedPeopleTransport } from '@graphql-cache/people/test-support';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import type { fetchContactDirectoryByIds } from '@service-storage/graphql-contacts';
import { expect, it, vi } from 'vitest';
import { contactRecordKey } from './contact-key';
import { reconcileContactPage } from './reconcile';

const viewer = 'macro|viewer@example.com';
const one = 'macro|one@example.com';
const two = 'macro|two@example.com';
const scope = {
  identity: viewer,
  storageGeneration: '00000000-0000-4000-8000-000000000001',
};
const fence = '00000000-0000-4000-8000-000000000002';
const person = (userId: string) => ({
  id: contactRecordKey(viewer, userId).slice('GraphqlContact:'.length),
  userId,
  email: userId.slice(6),
  name: null,
});
function fixture() {
  const snapshot = vi.fn<() => Promise<ContactSnapshot>>().mockResolvedValue({
    fence,
    ids: [one, two],
    nextCursor: 'cursor',
    incomplete: false,
  });
  const reconcile = vi.fn().mockResolvedValue(INITIAL_CACHE_REVISION);
  const host = {
    people: createPeopleCache({
      ...unsupportedPeopleTransport,
      snapshot,
      reconcile,
    }),
  };
  const fetch = vi.fn<typeof fetchContactDirectoryByIds>().mockResolvedValue({
    user: { id: viewer, contactsByUserIds: [person(one)] },
  });
  return { host, snapshot, reconcile, fetch };
}
it('verifies only the bounded local window and commits explicit requested-ID omissions', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  expect(
    await reconcileContactPage(f.host, scope, 'before', signal, f.fetch)
  ).toEqual({ nextCursor: 'cursor', incomplete: false });
  expect(f.fetch).toHaveBeenCalledWith([one, two], signal);
  expect(f.reconcile.mock.calls[0][0]).toEqual({
    scope,
    fence,
    viewer,
    requested: [one, two],
    present: [one],
  });
});
it('does not delete for a failure or canceled response', async () => {
  const f = fixture();
  f.fetch.mockRejectedValueOnce(new Error('offline'));
  await expect(
    reconcileContactPage(
      f.host,
      scope,
      null,
      new AbortController().signal,
      f.fetch
    )
  ).rejects.toThrow('offline');
  const deferred =
    Promise.withResolvers<
      Awaited<ReturnType<typeof fetchContactDirectoryByIds>>
    >();
  const entered = Promise.withResolvers<void>();
  f.fetch.mockImplementationOnce(() => {
    entered.resolve();
    return deferred.promise;
  });
  const controller = new AbortController();
  const pending = reconcileContactPage(
    f.host,
    scope,
    null,
    controller.signal,
    f.fetch
  );
  await entered.promise;
  controller.abort();
  deferred.resolve({ user: { id: viewer, contactsByUserIds: [] } });
  await expect(pending).rejects.toThrow();
  expect(f.reconcile).not.toHaveBeenCalled();
});
it('rejects foreign, unsolicited, duplicate and self-omitting evidence', async () => {
  for (const data of [
    { user: { id: 'macro|other@example.com', contactsByUserIds: [] } },
    {
      user: {
        id: viewer,
        contactsByUserIds: [person('macro|extra@example.com')],
      },
    },
    { user: { id: viewer, contactsByUserIds: [person(one), person(one)] } },
    {
      user: {
        id: viewer,
        contactsByUserIds: [{ ...person(one), id: 'foreign-key' }],
      },
    },
  ]) {
    const f = fixture();
    f.fetch.mockResolvedValue(data);
    await expect(
      reconcileContactPage(
        f.host,
        scope,
        null,
        new AbortController().signal,
        f.fetch
      )
    ).rejects.toThrow();
    expect(f.reconcile).not.toHaveBeenCalled();
  }
  const f = fixture();
  f.snapshot.mockResolvedValue({
    fence,
    ids: [viewer],
    nextCursor: null,
    incomplete: false,
  });
  f.fetch.mockResolvedValue({ user: { id: viewer, contactsByUserIds: [] } });
  await expect(
    reconcileContactPage(
      f.host,
      scope,
      null,
      new AbortController().signal,
      f.fetch
    )
  ).rejects.toThrow();
  expect(f.reconcile).not.toHaveBeenCalled();
});
it('preserves empty continuations and reports malformed local membership without guessing', async () => {
  const f = fixture();
  f.snapshot.mockResolvedValue({
    fence,
    ids: [],
    nextCursor: 'next',
    incomplete: true,
  });
  expect(
    await reconcileContactPage(
      f.host,
      scope,
      null,
      new AbortController().signal,
      f.fetch
    )
  ).toEqual({ nextCursor: 'next', incomplete: true });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.reconcile).not.toHaveBeenCalled();
});
