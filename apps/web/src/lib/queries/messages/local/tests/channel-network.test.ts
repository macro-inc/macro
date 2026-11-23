import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { gql } from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { fromValue } from 'wonka';
import { cacheSessionChanged, queryChannelNetwork } from '../channel-network';

const session = vi.hoisted(() => ({ generation: 'generation-1' }));
const answer = vi.hoisted(() => ({
  persistence: undefined as Promise<string | undefined> | undefined,
}));

vi.mock('@graphql-cache/session-generation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@graphql-cache/session-generation')>();
  return {
    ...actual,
    cacheSessionGeneration: Object.assign(
      Object.create(actual.cacheSessionGeneration),
      { capture: () => session.generation }
    ),
  };
});

vi.mock('@graphql-cache/exchange/normalized-cache-exchange', () => ({
  normalizedCacheResultMetadata: () => ({
    source: 'live-network',
    persistence: answer.persistence,
  }),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({
    query: () =>
      fromValue({ data: { ok: true }, stale: false, hasNext: false }),
  }),
}));

const QUERY = gql`
  query Probe {
    ok
  }
`;

describe('queryChannelNetwork', () => {
  it('says the session changed when the cache refused a read sent under an earlier one', async () => {
    session.generation = 'generation-1';
    let refuse!: () => void;
    answer.persistence = new Promise((resolve) => {
      refuse = () => resolve(undefined);
    });
    const { cached } = await queryChannelNetwork(QUERY, {});

    // Startup's first owner proof replaces the session the read was sent under.
    session.generation = 'generation-2';
    refuse();

    let error: unknown;
    try {
      await cached;
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(StaleCacheAuthorityError);
    expect(cacheSessionChanged(error)).toBe(true);
  });

  it('fails a read the cache refused under the same session', async () => {
    session.generation = 'generation-1';
    answer.persistence = Promise.resolve(undefined);
    const { cached } = await queryChannelNetwork(QUERY, {});

    await expect(cached).rejects.toThrow('channel query could not be cached');
  });
});
