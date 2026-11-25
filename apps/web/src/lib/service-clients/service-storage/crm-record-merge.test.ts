import { predatesExternalWrite } from '@graphql-cache/exchange/external-writes';
import type { CacheHost } from '@graphql-cache/host/types';
import { clearRegisteredCaches } from '@graphql-cache/lifecycle';
import { beginCacheWriteSession } from '@graphql-cache/session-writes';
import { beforeEach, expect, it, vi } from 'vitest';
import { forgetMergedCrmRecords } from './crm-record-merge';

type FakeHost = {
  disabled: boolean;
  authority: {
    snapshot: () => undefined;
    current: ReturnType<typeof vi.fn>;
  };
  deleteRecords: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  host: undefined as unknown as FakeHost,
  calls: [] as string[],
  error: vi.fn(),
}));
vi.mock('./graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => mocks.host,
}));
vi.mock('@macro-inc/observability', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@macro-inc/observability')>();
  vi.spyOn(original.Telemetry, 'error').mockImplementation(mocks.error);
  return original;
});

function fakeHost(): FakeHost {
  return {
    disabled: false,
    // The cache owner has not answered yet, as on a page load.
    authority: {
      snapshot: () => undefined,
      current: vi.fn(async () => {
        mocks.calls.push('current');
      }),
    },
    deleteRecords: vi.fn(async () => {
      mocks.calls.push('delete');
      return { affected: [] };
    }),
  };
}

beforeEach(async () => {
  await clearRegisteredCaches();
  await beginCacheWriteSession(async () => {}).ready;
  mocks.calls = [];
  mocks.error.mockClear();
  mocks.host = fakeHost();
});

it("drops merged companies' and contacts' records under the owner's current generation", async () => {
  await forgetMergedCrmRecords({
    companies: ['company-1'],
    contacts: ['contact-1', 'contact-2'],
  });

  expect(mocks.host.deleteRecords).toHaveBeenCalledExactlyOnceWith([
    'GraphqlSoupCrmCompany:company-1',
    'GraphqlSoupCrmContact:contact-1',
    'GraphqlSoupCrmContact:contact-2',
  ]);
  // The host stamps a removal with the generation it has observed, so it asks
  // the owner for the current one first.
  expect(mocks.calls).toEqual(['current', 'delete']);
  // Reads that started before the drop can't put the records back.
  const host = mocks.host as unknown as CacheHost;
  for (const type of ['GraphqlSoupCrmCompany', 'GraphqlSoupCrmContact'])
    expect(predatesExternalWrite(host, 0, null, [type])).toBe(true);
});

it('drops a merged record once per cache', async () => {
  await forgetMergedCrmRecords({ companies: [], contacts: ['contact-1'] });
  await forgetMergedCrmRecords({
    companies: [],
    contacts: ['contact-1', 'contact-2'],
  });

  expect(mocks.host.deleteRecords.mock.calls).toEqual([
    [['GraphqlSoupCrmContact:contact-1']],
    [['GraphqlSoupCrmContact:contact-2']],
  ]);

  // Another cache, as after signing in again, has its own records to drop.
  mocks.host = fakeHost();
  await forgetMergedCrmRecords({ companies: [], contacts: ['contact-1'] });
  expect(mocks.host.deleteRecords).toHaveBeenCalledExactlyOnceWith([
    'GraphqlSoupCrmContact:contact-1',
  ]);
});

it('drops nothing when nothing was merged, or from a disabled cache', async () => {
  await forgetMergedCrmRecords({ companies: [], contacts: [] });
  mocks.host.disabled = true;
  await forgetMergedCrmRecords({ companies: [], contacts: ['contact-1'] });

  expect(mocks.host.authority.current).not.toHaveBeenCalled();
  expect(mocks.host.deleteRecords).not.toHaveBeenCalled();
});

it('drops nothing once the session it started in has ended', async () => {
  mocks.host.authority.current.mockImplementation(async () => {
    // A sign-out while the owner is asked; it doesn't wait for this drop.
    await beginCacheWriteSession(async () => {}).ready;
  });

  await forgetMergedCrmRecords({ companies: [], contacts: ['contact-1'] });

  expect(mocks.host.deleteRecords).not.toHaveBeenCalled();
});

it('reports an owner that cannot answer and drops nothing', async () => {
  const failure = new Error('owner lost');
  mocks.host.authority.current.mockRejectedValue(failure);

  await forgetMergedCrmRecords({ companies: [], contacts: ['contact-1'] });

  expect(mocks.error).toHaveBeenCalledExactlyOnceWith(failure);
  expect(mocks.host.deleteRecords).not.toHaveBeenCalled();
});

it('reports a refused removal and drops the record again next time', async () => {
  const refusal = new Error('stale');
  mocks.host.deleteRecords.mockRejectedValueOnce(refusal);

  await forgetMergedCrmRecords({ companies: [], contacts: ['contact-1'] });
  await forgetMergedCrmRecords({ companies: [], contacts: ['contact-1'] });

  expect(mocks.error).toHaveBeenCalledExactlyOnceWith(refusal);
  expect(mocks.host.deleteRecords).toHaveBeenCalledTimes(2);
});
