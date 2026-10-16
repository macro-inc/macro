import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCrmContacts, invalidateCachedCrmContacts } from './crm-contacts';

const mocks = vi.hoisted(() => ({
  cacheEnabled: true,
  query: vi.fn(),
  search: vi.fn(),
  deleteRecords: vi.fn(async () => undefined),
  invalidate: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: mocks.reportError },
}));

vi.mock('./graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: mocks.query }),
  getGraphqlSoupCacheHost: () =>
    mocks.cacheEnabled
      ? {
          search: mocks.search,
          deleteRecords: mocks.deleteRecords,
          invalidate: mocks.invalidate,
        }
      : undefined,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheEnabled = true;
});

describe('contact GraphQL listing', () => {
  it('opts into visible contacts and retains the continuation supplied by Soup', async () => {
    mocks.query.mockReturnValue({
      toPromise: async () => ({
        data: {
          user: {
            id: 'viewer',
            soup: {
              items: [{ __typename: 'GraphqlSoupCrmContact', id: 'contact-1' }],
              nextCursor: 'next-page',
            },
          },
        },
      }),
    });
    const page = await fetchCrmContacts({ search: ' Pat ', limit: 100 });
    expect(page.contacts).toHaveLength(1);
    expect(page.nextCursor).toBe('next-page');
    expect(mocks.query.mock.calls[0][1]).toMatchObject({
      input: {
        initial: {
          limit: 100,
          sortMethod: 'UPDATED_AT',
          filters: {
            crmContactFilter: {
              and: {
                left: { literal: { hidden: false } },
                right: { literal: { search: 'Pat' } },
              },
            },
          },
        },
      },
    });
    await fetchCrmContacts({
      cursor: page.nextCursor,
      search: 'changed',
      limit: 100,
    });
    expect(mocks.query.mock.calls[1][1]).toEqual({
      input: { continuation: { cursor: 'next-page' } },
    });
  });

  it('propagates network errors instead of returning an empty successful page', async () => {
    const error = new Error('offline');
    mocks.query.mockReturnValue({ toPromise: async () => ({ error }) });
    await expect(fetchCrmContacts({ limit: 100 })).rejects.toBe(error);
  });
});

describe('REST contact mutation cache cleanup', () => {
  it('deletes durable contact facts so a hidden record cannot return from the cold cache', async () => {
    await invalidateCachedCrmContacts('contact-1');
    expect(mocks.deleteRecords).toHaveBeenCalledWith([
      'GraphqlSoupCrmContact:contact-1',
    ]);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('collects every contact page before deleting company-derived cached facts', async () => {
    const cursor = { timestampMs: 0, recordKey: 'GraphqlSoupCrmContact:first' };
    mocks.search
      .mockResolvedValueOnce({
        documents: [{ recordKey: 'GraphqlSoupCrmContact:first' }],
        nextCursor: cursor,
      })
      .mockResolvedValueOnce({
        documents: [{ recordKey: 'GraphqlSoupCrmContact:second' }],
        nextCursor: null,
      });
    await invalidateCachedCrmContacts();
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search.mock.calls[1][0].cursor).toEqual(cursor);
    expect(mocks.deleteRecords).toHaveBeenCalledWith([
      'GraphqlSoupCrmContact:first',
      'GraphqlSoupCrmContact:second',
    ]);
    expect(mocks.search.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.deleteRecords.mock.invocationCallOrder[0]
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it('works when the normalized cache is disabled', async () => {
    mocks.cacheEnabled = false;
    await invalidateCachedCrmContacts('contact-1');
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it('reports a cache failure without interrupting the successful REST mutation and refetch', async () => {
    const error = new Error('cache worker stopped');
    mocks.deleteRecords.mockRejectedValueOnce(error);
    await expect(
      invalidateCachedCrmContacts('contact-1')
    ).resolves.toBeUndefined();
    expect(mocks.reportError).toHaveBeenCalledWith(error);
  });
});
