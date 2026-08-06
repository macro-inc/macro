import { ThrownResultError } from '@core/util/result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mapThread: vi.fn(),
  query: vi.fn(),
  toPromise: vi.fn(),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: mocks.query }),
}));

vi.mock('./mapper', () => ({
  mapGraphqlEmailThreadPage: mocks.mapThread,
}));

import { fetchGraphqlEmailThreadPage } from './thread';

describe('fetchGraphqlEmailThreadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReturnValue({ toPromise: mocks.toPromise });
  });

  it('fetches a cache-and-network page and maps the thread', async () => {
    const graphqlThread = { id: 'thread-1' };
    const mappedThread = { db_id: 'thread-1', messages: [] };
    mocks.toPromise.mockResolvedValue({
      data: { user: { emailThread: graphqlThread } },
    });
    mocks.mapThread.mockReturnValue(mappedThread);

    await expect(fetchGraphqlEmailThreadPage('thread-1', 20, 20)).resolves.toBe(
      mappedThread
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.anything(),
      { threadId: 'thread-1', offset: 20, limit: 20 },
      { requestPolicy: 'cache-and-network' }
    );
    expect(mocks.mapThread).toHaveBeenCalledWith(graphqlThread);
  });

  it('maps a null lookup to the temporary not-found result error', async () => {
    mocks.toPromise.mockResolvedValue({
      data: { user: { emailThread: null } },
    });

    const error = await fetchGraphqlEmailThreadPage('missing', 0, 20).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ThrownResultError);
    if (!(error instanceof ThrownResultError)) throw error;
    expect(error.errors).toContainEqual({
      code: 'NOT_FOUND',
      message: 'Email thread not found',
    });
  });

  it('preserves known GraphQL error codes for block load states', async () => {
    mocks.toPromise.mockResolvedValue({
      error: {
        graphQLErrors: [
          {
            message: 'Email thread is gone',
            extensions: { code: 'GONE' },
          },
        ],
      },
    });

    const error = await fetchGraphqlEmailThreadPage('gone', 0, 20).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ThrownResultError);
    if (!(error instanceof ThrownResultError)) throw error;
    expect(error.errors).toContainEqual({
      code: 'GONE',
      message: 'Email thread is gone',
    });
  });
});
